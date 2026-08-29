import { canonicalJson } from "./canonical-json.mjs";
import { renderFrontmatter } from "./frontmatter.mjs";
import { PAYLOAD_START, PAYLOAD_END } from "./note-parser.mjs";

export function renderNodeNote({ frontmatter, payload, heading, warning, navigation = [], related = [], rationaleTemplate = false }) {
  const sections = [renderFrontmatter(frontmatter), `\n# ${heading}\n`];
  if (warning) sections.push(`\n> [!warning] ${warning}\n`);
  if (payload) {
    sections.push(`\n## Structured graph payload\n\n${PAYLOAD_START}\n\`\`\`json\n${canonicalJson(payload).trimEnd()}\n\`\`\`\n${PAYLOAD_END}\n`);
  }
  if (navigation.length) sections.push(`\n## Source navigation\n\n${navigation.map((item) => `[[${item}]]`).join("\n\n")}\n`);
  if (related.length) sections.push(`\n## Related graph records\n\n${related.map((item) => `[[${item}]]`).join("\n\n")}\n`);
  if (rationaleTemplate) {
    sections.push("\n## Proposal rationale\n\nExplain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.\n");
    sections.push("\n## Regression intent\n\nList the existing or proposed regression cases that should distinguish the old and new behavior.\n");
  }
  return `${sections.join("").trimEnd()}\n`;
}

export function renderFrontmatterNote({ frontmatter, heading, body = "" }) {
  return `${renderFrontmatter(frontmatter)}\n# ${heading}\n${body ? `\n${body.trim()}\n` : ""}`;
}
