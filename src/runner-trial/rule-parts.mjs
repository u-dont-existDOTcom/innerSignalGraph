import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

// The runner trial's rule parts (docs/superpowers/specs/2026-11-21-runner-trial-design.md, section 2), cut by program from the
// served protocol exactly as loadTherapyProtocol({ boxGuidance: true }) returns it (SKILL.md's body and its ten reference files).
// This is the trial's only source of rules: nothing here reads the app's own rule text (src/prompts/common.mjs). A heading or
// anchor the cutter relies on that is missing stops the cut, so a protocol change that moves one must update this file in the
// same change.

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export const RULE_PART_FILES = Object.freeze({
  boxes: "references/INNER-CHILD-BOX-GUIDANCE.md",
  map: "references/INNER-CHILD-THERAPY-MAP.md"
});

// The reference files other than the box file and the map, by the short names workers and the box picker use.
export const REFERENCE_NAMES = Object.freeze({
  "PROTECTIVE-COMPATIBILITY": "references/PROTECTIVE-COMPATIBILITY.md",
  "PHENOMENOLOGY-AND-REPRESENTATION": "references/PHENOMENOLOGY-AND-REPRESENTATION.md",
  "PROTOCOL-STATE-PROVENANCE": "references/PROTOCOL-STATE-PROVENANCE.md",
  "ROLE-BELIEF-INTEGRITY": "references/ROLE-BELIEF-INTEGRITY.md",
  "FOCUS-DISCIPLINE": "references/FOCUS-DISCIPLINE.md",
  "LONGITUDINAL-SYNTHESIS": "references/LONGITUDINAL-SYNTHESIS.md",
  "RESPONSE-FIDELITY": "references/RESPONSE-FIDELITY.md",
  "GUIDE-REFERRALS": "references/GUIDE-REFERRALS.md"
});

const CRISIS_HEADING = "## When someone may want to die\n";
const PAIN_HEADING = "## Chronic pain care navigation and prior medical harm\n";
const HARM_REDUCTION_START = "When someone says they are about to take something,";
const BOXES_HEADING = "## Inner-child boxes\n";
const ROUTES_HEADING = "## Cross-guide routes\n";

function section(text, heading, name) {
  const start = text.indexOf(heading);
  if (start < 0) throw new ValidationError(`The served protocol has no "${heading.trim()}" (${name}).`, { code: "RUNNER_RULE_PART_MISSING" });
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, next < 0 ? text.length : next + 1).trimEnd() + "\n";
}

function paragraphStarting(text, start, name) {
  const at = text.indexOf(start);
  if (at < 0) throw new ValidationError(`The served protocol has no paragraph starting "${start}" (${name}).`, { code: "RUNNER_RULE_PART_MISSING" });
  const end = text.indexOf("\n\n", at);
  return text.slice(at, end < 0 ? text.length : end).trimEnd() + "\n";
}

function part(id, text, label) {
  return Object.freeze({ id, label, text, sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8") });
}

// The protocol's whole text as one served document, in the order the protocol tools serve it.
export function wholeProtocolText(protocol) {
  return [
    `# InnerSignal therapy protocol ${protocol.version} (sha256 ${protocol.protocolSha256})\n`,
    "## SKILL.md\n", protocol.instructions.trimEnd() + "\n",
    ...protocol.files.flatMap((file) => [`\n## ${file.path}\n`, file.content.trimEnd() + "\n"])
  ].join("\n");
}

export function cutRuleParts(protocol) {
  if (!protocol?.instructions || !Array.isArray(protocol.files)) throw new ValidationError("A loaded therapy protocol is required.");
  const file = (relative) => {
    const found = protocol.files.find((entry) => entry.path === relative);
    if (!found) throw new ValidationError(`The served protocol has no ${relative}; the runner trial needs the box guidance served.`, { code: "RUNNER_RULE_PART_MISSING" });
    return found.content;
  };
  const skill = protocol.instructions;
  const crisisText = [
    section(skill, CRISIS_HEADING, "crisis"),
    section(skill, PAIN_HEADING, "chronic pain"),
    "## Taking something for its effects\n\n" + paragraphStarting(skill, HARM_REDUCTION_START, "harm reduction")
  ].join("\n");
  const boxesFile = file(RULE_PART_FILES.boxes);
  const boxesSection = section(boxesFile, BOXES_HEADING, "boxes");
  const routesSection = section(boxesFile, ROUTES_HEADING, "routes");
  const boxes = new Map();
  for (const block of [boxesSection, routesSection]) {
    const pieces = block.split(/\n(?=### )/u).filter((piece) => piece.startsWith("### "));
    for (const piece of pieces) {
      const match = /^### ([A-Z][A-Z0-9_.]+): (.+)$/mu.exec(piece);
      if (!match) throw new ValidationError("A box heading in the box guidance is not in the form '### ID: title'.", { code: "RUNNER_RULE_PART_MISSING" });
      if (boxes.has(match[1])) throw new ValidationError(`The box guidance lists ${match[1]} twice.`, { code: "RUNNER_RULE_PART_MISSING" });
      boxes.set(match[1], part(`box:${match[1]}`, piece.trimEnd() + "\n", match[2]));
    }
  }
  if (boxes.size < 10) throw new ValidationError("The box guidance yielded too few boxes to be the served file.", { code: "RUNNER_RULE_PART_MISSING" });
  const boxIndex = [...boxes.entries()].map(([id, value]) => `${id}: ${value.label}`).join("\n") + "\n";
  const boxPreamble = boxesFile.slice(0, boxesFile.indexOf(BOXES_HEADING)).trimEnd() + "\n";
  const references = Object.fromEntries(Object.entries(REFERENCE_NAMES).map(([name, relative]) => [name, part(`ref:${name}`, file(relative), name)]));
  return Object.freeze({
    protocol: Object.freeze({ id: protocol.protocolId, version: protocol.version, sha256: protocol.protocolSha256 }),
    crisis: part("crisis", crisisText, "crisis"),
    skill: part("skill", skill, "SKILL.md"),
    map: part("map", file(RULE_PART_FILES.map), "map"),
    boxPreamble: part("box-preamble", boxPreamble, "box preamble"),
    boxIndex: part("box-index", boxIndex, "box index"),
    boxes: Object.freeze(Object.fromEntries(boxes)),
    references: Object.freeze(references),
    whole: part("whole", wholeProtocolText(protocol), "whole protocol")
  });
}

// What every worker that gets only part of the rules is told about what it has (design, section 2: SKILL.md tells a host to read
// files first and names host tools, which a worker here doesn't have).
export function runnerPreface(partLabels) {
  return `RUNNER NOTE. You are one step of InnerSignal's local runner. You have these parts of InnerSignal's served rules: ${partLabels.join("; ")}. Where the rules tell you to read a file or use a tool you don't have, it wasn't picked for this step, and you have no tools: follow the rules you have.\n`;
}

// Focused rules: the whole protocol except the advice of the boxes not in play (SKILL.md, the map, every reference file but the
// box file, the box file's preamble and the picked boxes).
export function focusedRules(parts, boxIds = []) {
  const boxes = boxIds.map((id) => parts.boxes[id]).filter(Boolean);
  const references = Object.values(parts.references);
  const sections = [parts.skill, parts.map, ...references, parts.boxPreamble, ...boxes];
  const labels = ["SKILL.md", "the therapy map", ...references.map((ref) => ref.label), `the advice of these boxes: ${boxes.map((box) => box.id.slice(4)).join(", ") || "none"}`];
  return Object.freeze({
    text: [runnerPreface(labels), ...sections.map((section) => `\n=== ${section.label} ===\n${section.text}`)].join("\n"),
    parts: sections.map((section) => ({ id: section.id, sha256: section.sha256, bytes: section.bytes })),
    boxIds: boxes.map((box) => box.id.slice(4))
  });
}

export function wholeRules(parts) {
  return Object.freeze({
    text: `${runnerPreface(["the whole served protocol"])}\n${parts.whole.text}`,
    parts: [{ id: parts.whole.id, sha256: parts.whole.sha256, bytes: parts.whole.bytes }],
    boxIds: Object.keys(parts.boxes)
  });
}

export function rulesFrom(sections, labels) {
  return Object.freeze({
    text: [runnerPreface(labels), ...sections.map((section) => `\n=== ${section.label} ===\n${section.text}`)].join("\n"),
    parts: sections.map((section) => ({ id: section.id, sha256: section.sha256, bytes: section.bytes }))
  });
}
