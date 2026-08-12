import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../core/hash.mjs";
import { ValidationError } from "../core/errors.mjs";

function normalizeLines(text) {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export async function buildTextSourceMap({ root, guide }) {
  const fullPath = path.join(root, "guides", guide.file);
  const text = await fs.readFile(fullPath, "utf8");
  const lines = normalizeLines(text);
  const starts = guide.sections.map((section) => {
    const index = lines.findIndex((line) => line.trim() === section.heading);
    if (index < 0) throw new ValidationError(`Missing source heading ${section.heading} in ${guide.file}.`);
    return { ...section, index };
  });
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i].index <= starts[i - 1].index) throw new ValidationError(`Source headings are out of order in ${guide.file}.`);
  }
  return {
    guideId: guide.guideId,
    file: guide.file,
    sections: starts.map((section, index) => {
      const next = starts[index + 1];
      const endIndex = next ? next.index - 1 : lines.length - 1;
      const sectionText = lines.slice(section.index, endIndex + 1).join("\n").trim();
      return {
        id: section.id,
        heading: section.heading,
        lineStart: section.index + 1,
        lineEnd: endIndex + 1,
        sha256: sha256(sectionText),
        excerpt: sectionText.slice(0, 500)
      };
    })
  };
}
