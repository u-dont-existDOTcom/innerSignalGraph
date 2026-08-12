import fs from "node:fs/promises";
import { readActiveGuidePacketEntry } from "../guide-packet/store.mjs";
import { htmlToText } from "../guide-packet/source-html.mjs";

export async function loadGuide(config) {
  const [activeSource, activeManifest] = await Promise.all([
    readActiveGuidePacketEntry(config, "guides/inner-child/canonical-source.html"),
    readActiveGuidePacketEntry(config, "manifest.json")
  ]);
  if (activeSource && activeManifest) {
    const manifest = JSON.parse(activeManifest.toString("utf8"));
    return {
      text: htmlToText(activeSource.toString("utf8")),
      manifest: {
        ...manifest,
        version: manifest.packetVersion,
        guidePacketVersion: manifest.packetVersion,
        sources: manifest.guides?.map((guide) => ({ id: guide.id, version: guide.revision, sha256: guide.sourceSha256 })) ?? []
      }
    };
  }
  const [text, manifestRaw] = await Promise.all([
    fs.readFile(config.guidePath, "utf8"),
    fs.readFile(config.guideManifestPath, "utf8")
  ]);
  return { text, manifest: JSON.parse(manifestRaw) };
}

export async function loadSomaticGuide(config) {
  const activeSource = await readActiveGuidePacketEntry(config, "guides/somatic/canonical-source.html");
  if (activeSource) return htmlToText(activeSource.toString("utf8"));
  return fs.readFile(config.somaticGuidePath, "utf8");
}

function normalizeTokens(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9'’-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

const expansions = new Map([
  ["angry", ["anger", "resentful", "resentment", "critic", "attack", "war"]],
  ["child", ["younger", "parent", "reparenting", "inner-child"]],
  ["unsafe", ["safety", "protector", "trust", "credible", "credibility"]],
  ["love", ["nurturer", "warmth", "care", "non-cruelty"]],
  ["fake", ["skeptic", "cynical", "guard", "inherited"]],
  ["relaxation", ["regulation", "somatic", "bottom-up", "dialogue"]]
]);

function isHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 100 || /[.!]$/.test(trimmed)) return false;
  if (/^(https?:|u-dont-exist\.com|Spirit and Mind Health$)/i.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 14) return false;
  const titleish = words.filter((word) => /^[A-Z“"'0-9]/.test(word)).length;
  return titleish / Math.max(words.length, 1) >= 0.45;
}

export function splitGuideIntoSections(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let heading = "Opening";
  let body = [];

  const flush = () => {
    const content = body.join("\n").trim();
    if (content) sections.push({ heading, content });
    body = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const previousBlank = i === 0 || !lines[i - 1].trim();
    const nextNonBlank = lines.slice(i + 1).find((candidate) => candidate.trim());
    if (previousBlank && nextNonBlank && isHeading(line)) {
      flush();
      heading = line.trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

export function selectGuideExcerpts(text, query, maxChars = 18000) {
  const sections = splitGuideIntoSections(text);
  const queryTokens = normalizeTokens(query);
  for (const token of [...queryTokens]) {
    for (const expanded of expansions.get(token) ?? []) queryTokens.add(expanded);
  }

  const priorityHeadings = [
    "Before You Try to Go Deep",
    "Borrow the Adult Before You Can Be the Adult",
    "Become the Adult Apprentice",
    "The Three Adult Functions",
    "Make the Protector Visible",
    "When the Adult Voice Feels Fake",
    "The Parent You Inherited",
    "Start With Whatever Showed Up",
    "The Two Common Guards",
    "A Bottom-Up Sequence"
  ];

  const scored = sections.map((section, index) => {
    const tokens = normalizeTokens(`${section.heading} ${section.content}`);
    let score = 0;
    for (const token of queryTokens) {
      if (tokens.has(token)) score += token.length >= 8 ? 4 : 2;
    }
    const priority = priorityHeadings.indexOf(section.heading);
    if (priority >= 0) score += 18 - priority;
    return { ...section, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  let used = 0;
  for (const section of scored) {
    if (section.score <= 0 && chosen.length >= 6) continue;
    const rendered = `## ${section.heading}\n${section.content}`;
    if (used + rendered.length > maxChars && chosen.length >= 4) continue;
    chosen.push({ ...section, rendered });
    used += rendered.length;
    if (used >= maxChars) break;
  }

  chosen.sort((a, b) => a.index - b.index);
  return chosen.map((section) => section.rendered).join("\n\n").slice(0, maxChars);
}
