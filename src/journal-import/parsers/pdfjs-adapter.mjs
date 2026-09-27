import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { getDocument, OPS, version as pdfjsVersion, build as pdfjsBuild } from "pdfjs-dist/legacy/build/pdf.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const imageOperators = new Set([
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintSolidColorImageMask,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintImageXObjectRepeat
]);

function countStructureRoles(node, counts = { tables: 0, figures: 0 }) {
  if (!node || typeof node !== "object") return counts;
  if (node.role === "Table") counts.tables += 1;
  if (node.role === "Figure") counts.figures += 1;
  if (Array.isArray(node.children)) node.children.forEach((child) => countStructureRoles(child, counts));
  return counts;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function textRepresentation(items) {
  let text = "";
  const mapped = [];
  let previous = null;
  const flags = new Set();
  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const separator = text.length === 0 ? "" : (previous?.hasEOL ? "\n" : " ");
    text += separator;
    const start = Buffer.byteLength(text, "utf8");
    text += item.str;
    const end = Buffer.byteLength(text, "utf8");
    const transform = Array.isArray(item.transform) ? item.transform.map(finiteNumber) : [];
    const x = transform[4];
    const y = transform[5];
    if (previous) {
      const priorX = previous.transform?.[4];
      const priorY = previous.transform?.[5];
      const tolerance = Math.max(2, finiteNumber(item.height) ?? 0, finiteNumber(previous.height) ?? 0);
      if (Number.isFinite(y) && Number.isFinite(priorY) && y > priorY + tolerance) flags.add("vertical_sequence_regression");
      if (Number.isFinite(x) && Number.isFinite(priorX) && Number.isFinite(y) && Number.isFinite(priorY)
        && Math.abs(y - priorY) <= tolerance && x + tolerance < priorX) flags.add("same_line_horizontal_regression");
      if (item.dir && previous.dir && item.dir !== previous.dir) flags.add("mixed_text_directions");
    }
    if (item.str.includes("\uFFFD")) flags.add("replacement_glyph");
    mapped.push({
      item_index: mapped.length,
      text: item.str,
      dir: item.dir ?? null,
      transform,
      width: finiteNumber(item.width),
      height: finiteNumber(item.height),
      has_eol: Boolean(item.hasEOL),
      representation_start_byte: start,
      representation_end_byte: end
    });
    previous = item;
  }
  return { text, items: mapped, flags: [...flags].sort() };
}

function annotationInventory(annotations) {
  return annotations.map((annotation, index) => ({
    annotation_index: index,
    subtype: typeof annotation.subtype === "string" ? annotation.subtype : "unknown",
    rect: Array.isArray(annotation.rect) ? annotation.rect.map(finiteNumber) : null,
    has_external_target: Boolean(annotation.url || annotation.unsafeUrl || annotation.action),
    has_attachment: Boolean(annotation.file)
  }));
}

function attachmentInventory(attachments) {
  if (!attachments || typeof attachments !== "object") return [];
  return Object.entries(attachments).map(([name, attachment], index) => ({
    attachment_index: index,
    name_sha256: digest(Buffer.from(name, "utf8")),
    byte_length: attachment?.content?.byteLength ?? null,
    content_type: typeof attachment?.contentType === "string" ? attachment.contentType : null,
    disposition: "retained_in_original_not_executed"
  }));
}

export async function parsePdfFile({ inputPath, byteLimit, pageLimit, imageLimit, representationByteLimit }) {
  const bytes = await fs.readFile(inputPath);
  if (bytes.byteLength > byteLimit) throw Object.assign(new Error("SOURCE_BYTE_LIMIT_EXCEEDED"), { code: "SOURCE_BYTE_LIMIT_EXCEEDED" });
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    stopEvent: true,
    verbosity: 0
  });
  let document;
  try { document = await loadingTask.promise; }
  catch { throw Object.assign(new Error("PDF_PARSE_FAILED"), { code: "PDF_PARSE_FAILED" }); }
  try {
    if (document.numPages > pageLimit) throw Object.assign(new Error("SOURCE_PAGE_LIMIT_EXCEEDED"), { code: "SOURCE_PAGE_LIMIT_EXCEEDED" });
    const pages = [];
    const representations = [];
    const visualPending = [];
    let totalImages = 0;
    let totalRepresentationBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const [textContent, operatorList, annotations, structure] = await Promise.all([
        page.getTextContent({ disableNormalization: false, includeMarkedContent: true }),
        page.getOperatorList(),
        page.getAnnotations({ intent: "display" }),
        page.getStructTree().catch(() => null)
      ]);
      const textItems = textContent.items.filter((item) => item && typeof item.str === "string");
      const representation = textRepresentation(textItems);
      const imageInventory = [];
      for (let operationIndex = 0; operationIndex < operatorList.fnArray.length; operationIndex += 1) {
        if (!imageOperators.has(operatorList.fnArray[operationIndex])) continue;
        const rawName = operatorList.argsArray[operationIndex]?.[0];
        imageInventory.push({
          operation_index: operationIndex,
          resource_name: typeof rawName === "string" || typeof rawName === "number" ? String(rawName) : null
        });
      }
      totalImages += imageInventory.length;
      if (totalImages > imageLimit) throw Object.assign(new Error("SOURCE_IMAGE_LIMIT_EXCEEDED"), { code: "SOURCE_IMAGE_LIMIT_EXCEEDED" });
      const representationBytes = Buffer.byteLength(representation.text, "utf8");
      totalRepresentationBytes += representationBytes;
      if (totalRepresentationBytes > representationByteLimit) {
        throw Object.assign(new Error("SOURCE_REPRESENTATION_LIMIT_EXCEEDED"), { code: "SOURCE_REPRESENTATION_LIMIT_EXCEEDED" });
      }
      const pageIndex = pageNumber - 1;
      const representationId = `representation:pdf-page:${pageIndex}:native:1`;
      const roleCounts = countStructureRoles(structure);
      const reasons = [];
      if (representation.text.length === 0) reasons.push("no_native_text");
      if (imageInventory.length > 0) reasons.push("content_bearing_image_present");
      if (roleCounts.tables > 0) reasons.push("structured_table_present");
      if (representation.flags.length > 0) reasons.push("reading_order_requires_review");
      const disposition = representation.text.length === 0
        ? "visual_pending"
        : (representation.flags.length > 0 || roleCounts.tables > 0 ? "review_required" : "readable");
      const pageRecord = {
        page_index: pageIndex,
        page_number: pageNumber,
        geometry: { width: finiteNumber(viewport.width), height: finiteNumber(viewport.height), rotation: finiteNumber(viewport.rotation) },
        representation_id: representationId,
        disposition,
        text_items: representation.items,
        reading_order: { status: representation.flags.length > 0 ? "review_required" : "native_sequence", flags: representation.flags },
        image_inventory: imageInventory,
        table_inventory: { tagged_table_count: roleCounts.tables, tagged_figure_count: roleCounts.figures },
        annotations: annotationInventory(annotations),
        warnings: reasons
      };
      pages.push(pageRecord);
      representations.push({
        representation_id: representationId,
        representation_version: 1,
        kind: "pdf_native_text",
        page_index: pageIndex,
        text: representation.text,
        utf8_byte_length: representationBytes,
        sha256: digest(Buffer.from(representation.text, "utf8"))
      });
      if (disposition !== "readable") {
        visualPending.push({
          page_index: pageIndex,
          representation_id: representationId,
          disposition,
          reasons,
          locator: { page_index: pageIndex, region_id: null }
        });
      }
      page.cleanup();
    }
    return {
      protocol_version: "1.0",
    parser: { adapter: "pdfjs-dist", version: pdfjsVersion, build: pdfjsBuild ?? null, license: "Apache-2.0" },
      source: { format: "pdf", mime_type: "application/pdf", byte_length: bytes.byteLength, sha256: digest(bytes) },
      pages,
      representations,
      attachments: attachmentInventory(await document.getAttachments()),
      visual_pending: visualPending,
      warnings: []
    };
  } finally {
    await loadingTask.destroy();
  }
}
