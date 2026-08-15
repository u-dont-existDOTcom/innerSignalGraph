import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const HTML_ENTITIES = Object.freeze({
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">"
});

function decodeEntities(value) {
  return value.replace(/(?:&(?:nbsp|amp|quot|apos|lt|gt);|&#39;)/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()]);
}

export function htmlToText(value) {
  return decodeEntities(String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim());
}

export function extractEditorBody(html) {
  const source = String(html);
  const match = source.match(/^<div\b[^>]*\bcontenteditable=["']true["'][^>]*>([\s\S]*)<\/div>\s*$/i);
  if (!match) throw new Error("Canonical guide HTML must contain one complete contenteditable editor root.");
  const body = match[1];
  return { body, sha256: sha256(body), sourceSha256: sha256(source) };
}

function slug(value) {
  return value.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").toUpperCase() || "SECTION";
}

export function extractHtmlSections(html, { guideId, aliases = {} } = {}) {
  const { body } = extractEditorBody(html);
  const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  for (let match; (match = headingPattern.exec(body));) {
    headings.push({ start: match.index, end: headingPattern.lastIndex, level: Number(match[1]), heading: htmlToText(match[2]) });
  }
  const used = new Map();
  return headings.map((heading, index) => {
    const nextStart = headings[index + 1]?.start ?? body.length;
    const rawHtml = body.slice(heading.start, nextStart);
    const baseId = aliases[heading.heading] || `${String(guideId || "GUIDE").toUpperCase().replace(/[^A-Z0-9]+/g, ".")}.${slug(heading.heading)}`;
    const count = (used.get(baseId) ?? 0) + 1;
    used.set(baseId, count);
    const id = count === 1 ? baseId : `${baseId}.${count}`;
    const text = htmlToText(rawHtml);
    return {
      id,
      heading: heading.heading,
      level: heading.level,
      ordinal: index + 1,
      startOffset: heading.start,
      endOffset: nextStart,
      rawHtmlSha256: sha256(rawHtml),
      textSha256: sha256(text),
      excerpt: text.slice(0, 360),
      rawHtml
    };
  });
}

export function buildSourceMap({ guideId, revision, sourcePath, html, aliases }) {
  const extracted = extractEditorBody(html);
  const sections = extractHtmlSections(html, { guideId, aliases });
  return {
    guideId,
    revision,
    sourcePath,
    sourceSha256: extracted.sourceSha256,
    editorBodySha256: extracted.sha256,
    sectionCount: sections.length,
    sections: sections.map(({ rawHtml, ...section }) => section)
  };
}
