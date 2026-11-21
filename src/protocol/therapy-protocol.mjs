import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The InnerSignal therapy protocol served over MCP. The packaged plugin skill is the
// single source: the same SKILL.md body and reference files that the Codex plugin bundles
// are read from the deployed build, hashed, and returned by the protocol tools. A map or
// rule fix therefore reaches MCP hosts when the server is redeployed, with no plugin
// reinstall.

export const THERAPY_PROTOCOL_ID = "inner-signal-therapy";

const DEFAULT_PLUGIN_ROOT = new URL("../../plugins/inner-signal-therapy/", import.meta.url);

// Whether chats receive the advice and cautions inside every map box (owner answer 378a, 20 Nov 2026). This constant is
// the one switch for it. Off, the box file leaves the served list and the served texts lose the sentences that point to it
// (withoutBoxGuidancePointers), so no host is told to read a file it does not receive; the packaged file stays in the
// plugin, and `npm run authoring:maps:check` keeps it current. The protective-part rule, the one rule the 20 Nov test chats
// found only in a box, is in SKILL.md too, so it reaches chats in both settings.
export const SERVE_INNER_CHILD_BOX_GUIDANCE = true;

const BOX_GUIDANCE_FILE = "references/INNER-CHILD-BOX-GUIDANCE.md";

// Fixed order: the always-read files first, in the order the skill lists them, then the
// conditional guide-referral file. Every always-read reference must be served, or an MCP
// host receives instructions to read a file it cannot see.
export function therapyProtocolFiles({ boxGuidance = SERVE_INNER_CHILD_BOX_GUIDANCE } = {}) {
  return Object.freeze([
    "references/PROTECTIVE-COMPATIBILITY.md",
    "references/INNER-CHILD-THERAPY-MAP.md",
    ...(boxGuidance ? [BOX_GUIDANCE_FILE] : []),
    "references/PHENOMENOLOGY-AND-REPRESENTATION.md",
    "references/PROTOCOL-STATE-PROVENANCE.md",
    "references/ROLE-BELIEF-INTEGRITY.md",
    "references/FOCUS-DISCIPLINE.md",
    "references/LONGITUDINAL-SYNTHESIS.md",
    "references/RESPONSE-FIDELITY.md",
    "references/GUIDE-REFERRALS.md"
  ]);
}

export const THERAPY_PROTOCOL_FILES = therapyProtocolFiles();

const BOX_GUIDANCE_NAME = "INNER-CHILD-BOX-GUIDANCE.md";
const BOX_GUIDANCE_LIST_ENTRY = `\`${BOX_GUIDANCE_FILE}\`, `;

// A served text without its pointers to the box guidance, for a build that does not serve it: the file's entry leaves the
// read list, and every other sentence naming it is left out, with its line when nothing else is on it (and then one blank
// line, so paragraphs stay apart). Today these are SKILL.md's read list and its sentence on where the boxes' advice is, and
// the map's note on the box file. A text that names none of them is returned unchanged, byte for byte.
export function withoutBoxGuidancePointers(text) {
  const lines = text.split("\n");
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replaceAll(BOX_GUIDANCE_LIST_ENTRY, "");
    if (line.includes(BOX_GUIDANCE_NAME)) {
      line = line.split(/(?<=\.) +/u).filter((sentence) => !sentence.includes(BOX_GUIDANCE_NAME)).join(" ");
      if (line === "") {
        if (lines[index + 1] === "" && (kept.length === 0 || kept.at(-1) === "")) index += 1;
        continue;
      }
    }
    kept.push(line);
  }
  return kept.join("\n");
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// The skill body after its frontmatter; leading blank lines are dropped, the rest is kept byte for byte.
function skillBody(markdown) {
  const match = /^---\n[\s\S]*?\n---\n/u.exec(markdown);
  return (match ? markdown.slice(match[0].length) : markdown).replace(/^(?:[ \t]*\n)+/u, "");
}

function requireContent(text, label) {
  if (text.trim() === "") throw new TherapyProtocolUnavailableError(`The packaged ${label} is empty.`);
  return text;
}

const REFERENCE_PREFIX = "references/";

// Inline code spans on one line, as CommonMark reads them: a run of N backticks opens a span that
// closes at the next run of exactly N backticks, a run with no matching close stays literal, and a
// backtick escaped by an odd run of backslashes outside a span cannot open one. Spans that would
// cross a line break are not recognized, so mentions inside them are reported.
function codeSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") { i += 1; continue; }
    let backslashes = 0;
    while (line[i - 1 - backslashes] === "\\") backslashes += 1;
    if (backslashes % 2 === 1) { i += 1; continue; }
    let width = 1;
    while (line[i + width] === "`") width += 1;
    let j = i + width;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== "`") { j += 1; continue; }
      let run = 1;
      while (line[j + run] === "`") run += 1;
      if (run === width) { close = j; break; }
      j += run;
    }
    if (close === -1) { i += width; continue; }
    spans.push({ start: i + width, end: close, width });
    i = close + width;
  }
  return spans;
}

// Served text may name a reference only in one unambiguous form: a single-backtick code span whose
// whole content is a served path, such as `references/FOCUS-DISCIPLINE.md`. Every other occurrence
// of "references/" is reported, whatever characters it uses: outside a code span, inside a wider
// span, inside a span that holds anything more or less than a served path, or in an unclosed one.
// The packaged skill already writes every reference this way.
export function unservedReferenceMentions(text, servedFiles = THERAPY_PROTOCOL_FILES) {
  const served = new Set(servedFiles);
  const unserved = [];
  for (const line of text.split("\n")) {
    const spans = codeSpans(line);
    for (let at = line.indexOf(REFERENCE_PREFIX); at !== -1; at = line.indexOf(REFERENCE_PREFIX, at + 1)) {
      const span = spans.find((candidate) => candidate.start <= at && at < candidate.end);
      const exact = span !== undefined && span.width === 1 && span.start === at && served.has(line.slice(span.start, span.end));
      if (!exact) unserved.push(line.slice(at, at + 120));
    }
  }
  return unserved;
}

// A served text that names an unserved reference makes the protocol unavailable, not incomplete.
function requireServedReferences(texts, servedFiles) {
  for (const [label, text] of texts) {
    const [mention] = unservedReferenceMentions(text, servedFiles);
    if (mention !== undefined) {
      throw new TherapyProtocolUnavailableError(`The packaged ${label} names ${mention}, which this server does not serve.`);
    }
  }
}

export class TherapyProtocolUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TherapyProtocolUnavailableError";
    this.code = "THERAPY_PROTOCOL_UNAVAILABLE";
  }
}

export function loadTherapyProtocol({ pluginRoot = DEFAULT_PLUGIN_ROOT, boxGuidance = SERVE_INNER_CHILD_BOX_GUIDANCE } = {}) {
  const root = pluginRoot instanceof URL ? pluginRoot : pathToFileURL(`${path.resolve(String(pluginRoot))}${path.sep}`);
  const servedFiles = therapyProtocolFiles({ boxGuidance });
  const serve = boxGuidance ? (text) => text : withoutBoxGuidancePointers;
  try {
    const manifest = JSON.parse(fs.readFileSync(new URL(".codex-plugin/plugin.json", root), "utf8"));
    if (manifest.name !== THERAPY_PROTOCOL_ID || typeof manifest.version !== "string") {
      throw new Error("The packaged plugin manifest does not identify the InnerSignal therapy protocol.");
    }
    const instructions = requireContent(serve(skillBody(fs.readFileSync(new URL("skills/inner-signal-therapy/SKILL.md", root), "utf8"))), "skill instructions");
    const files = servedFiles.map((relative) => {
      const content = requireContent(serve(fs.readFileSync(new URL(`skills/inner-signal-therapy/${relative}`, root), "utf8")), relative);
      return Object.freeze({ path: relative, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf8"), content });
    });
    requireServedReferences([["skill instructions", instructions], ...files.map((file) => [file.path, file.content])], servedFiles);
    const instructionsSha256 = sha256(instructions);
    const protocolSha256 = sha256(JSON.stringify({
      protocol_id: THERAPY_PROTOCOL_ID,
      version: manifest.version,
      instructions_sha256: instructionsSha256,
      files: files.map(({ path, sha256: digest }) => [path, digest])
    }));
    return Object.freeze({
      protocolId: THERAPY_PROTOCOL_ID,
      version: manifest.version,
      protocolSha256,
      instructions,
      instructionsSha256,
      files: Object.freeze(files)
    });
  } catch (error) {
    if (error instanceof TherapyProtocolUnavailableError) throw error;
    throw new TherapyProtocolUnavailableError("The InnerSignal therapy protocol could not be loaded from this build.", { cause: error });
  }
}

// The protocol's identity and its files, then how load_therapy_protocol serves it: every part's name, size and hash, what
// the first answer holds, and the groups to load before the first reply. Names and hashes only, no text.
export function therapyProtocolManifest(protocol) {
  const delivery = therapyProtocolDelivery(protocol);
  return {
    protocol_id: protocol.protocolId,
    version: protocol.version,
    protocol_sha256: protocol.protocolSha256,
    instructions_sha256: protocol.instructionsSha256,
    files: protocol.files.map(({ path, sha256: digest, bytes }) => ({ path, sha256: digest, bytes })),
    parts: delivery.all.map(({ name, sha256: digest, bytes, source }) => ({ name, sha256: digest, bytes, source })),
    first_answer: [...delivery.firstNames],
    load_before_first_reply: delivery.groups.map((group) => [...group])
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Delivery in parts (owner answer i60a, 21 Nov 2026). Hosts cut long tool results: ChatGPT kept about the first and last
// 5,000 tokens of the 325,393-character protocol of 0.2.5, and Claude hosts put it in a file, which a chat without file
// tools can't open. So load_therapy_protocol answers in parts, each answer small enough to reach any host whole: the
// first answer holds the start of the rules and the groups of parts to load before the first reply; later calls name
// parts (a group, the rest of the rules, a reference file, the box list, one box's advice) and get as many as fit in one
// answer. The parts are the packaged files' own text, cut at headings; nothing is reworded, and the protocol hash is
// unchanged.

// The most a protocol answer may hold, in UTF-8 bytes of its whole text. About 7,000 tokens: under the roughly 10,000
// tokens ChatGPT keeps of a tool result (measured on 21 Nov 2026: the first and last ~19,700 characters), with room to
// spare, and far under the 25,000 tokens Claude hosts show before they move a result to a file.
export const PROTOCOL_ANSWER_MAX_BYTES = 28_000;
// The most one part may hold. The difference is room for an answer's own text: its first line, the note on loading and
// the list of groups in the first answer, and each part's BEGIN and END lines. At 24,500 the rules' first part ends with
// the section on someone who may want to die; tests/split-delivery.test.mjs fails if that section leaves the first answer.
export const PROTOCOL_PART_MAX_BYTES = 24_500;

export const RULES_PART_PREFIX = "rules/";
export const BOX_LIST_PART = "boxes";
export const BOX_PART_PREFIX = "box/";
export const GROUP_PREFIX = "group/";
// Read when the rules say so, not before the first reply.
const ON_REQUEST_FILES = new Set(["references/GUIDE-REFERRALS.md"]);
// The safety boxes, loaded before the first reply with the rules and the always-read files: tier 1 of the compiled
// inner-child map and of the cross-guide routes. They hold what the rules' section on someone who may want to die relies
// on (the adult seat, the self/death inquiry, this precious human life) and the urgent medical, pain and fresh-grief
// routes. SKILL.md names the same boxes to read before responding, for the plugin that reads its own files. Every other
// box is loaded when it's used. tests/split-delivery.test.mjs checks this list against SKILL.md and both maps' tier 1.
export const SAFETY_BOX_IDS = Object.freeze([
  "IC.SAFETY_ORIENTATION", "IC.SUICIDAL_ADULT_SEAT", "IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.PRECIOUS_HUMAN_OPPORTUNITY",
  "ROUTE.MEDICAL_RED_FLAG", "ROUTE.ALTERED_MEDICAL_SAFETY", "ROUTE.REFRACTORY_PAIN_NAVIGATION", "ROUTE.FRESH_GRIEF_FIRST"
]);
// Loaded right after the safety boxes, so an app that stops early has it: it decides whether any exercise fits.
const EARLY_FILES = Object.freeze(["references/PROTECTIVE-COMPATIBILITY.md"]);
const MAX_REQUESTED_PARTS = 40;
// The most part names an answer lists as still to load; a request that covers more parts is answered 40 at a time.
const MAX_LISTED_PARTS = 40;
const MAX_ECHOED_UNKNOWN = 5;
const bytesOf = (text) => Buffer.byteLength(text, "utf8");

export class ProtocolRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtocolRequestError";
    this.code = "INVALID_PROTOCOL_REQUEST";
  }
}

// Offsets where a line starting with `prefix` begins (never 0): the places a text may be cut without splitting a line.
function lineStartsWith(text, prefix) {
  const cuts = [];
  for (let at = text.indexOf(`\n${prefix}`); at !== -1; at = text.indexOf(`\n${prefix}`, at + 1)) cuts.push(at + 1);
  return cuts;
}

// Paragraph starts: the first non-blank line after a blank line.
function paragraphStarts(text) {
  const cuts = [];
  const pattern = /\n[ \t]*\n(?=[^\n])/gu;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) cuts.push(match.index + match[0].length);
  return cuts;
}

function lineStarts(text) {
  const cuts = [];
  for (let at = text.indexOf("\n"); at !== -1 && at + 1 < text.length; at = text.indexOf("\n", at + 1)) cuts.push(at + 1);
  return cuts;
}

const CUT_LEVELS = [(text) => lineStartsWith(text, "## "), (text) => lineStartsWith(text, "### "), paragraphStarts, lineStarts];

// The text in consecutive pieces of at most `max` bytes whose concatenation is the text, byte for byte: cut at the
// highest-level boundary that works (a level-2 heading, then a level-3 heading, then a paragraph, then a line), and
// consecutive pieces joined while they fit. A single line longer than `max` is cut between code points.
export function textPieces(text, max, level = 0) {
  if (bytesOf(text) <= max) return [text];
  // Joins consecutive units while they fit, counting bytes as it goes.
  const join = (units) => {
    const pieces = [];
    let current = "";
    let size = 0;
    for (const unit of units) {
      const unitSize = bytesOf(unit);
      if (current !== "" && size + unitSize > max) { pieces.push(current); current = ""; size = 0; }
      current += unit;
      size += unitSize;
    }
    if (current !== "") pieces.push(current);
    return pieces;
  };
  if (level >= CUT_LEVELS.length) return join(Array.from(text));
  const cuts = CUT_LEVELS[level](text);
  if (cuts.length === 0) return textPieces(text, max, level + 1);
  const units = [];
  let start = 0;
  for (const cut of [...cuts, text.length]) {
    const unit = text.slice(start, cut);
    units.push(...(bytesOf(unit) <= max ? [unit] : textPieces(unit, max, level + 1)));
    start = cut;
  }
  return join(units);
}

const BOX_HEADING = /^### ([A-Z][A-Z0-9]*\.[A-Z0-9_]+): (.+)$/u;

// The box file as its opening text, its group headings and one section per box. The pieces rebuild the file exactly, or
// the protocol is unavailable. A box's part is its section; the opening and the group headings go into the box list.
export function boxSections(content) {
  const groupCuts = lineStartsWith(content, "## ");
  if (groupCuts.length === 0) throw new TherapyProtocolUnavailableError(`The packaged ${BOX_GUIDANCE_FILE} has no box groups.`);
  const opening = content.slice(0, groupCuts[0]);
  const groups = [];
  const boxes = [];
  const bounds = [...groupCuts, content.length];
  for (let index = 0; index < groupCuts.length; index += 1) {
    const groupText = content.slice(bounds[index], bounds[index + 1]);
    const boxCuts = lineStartsWith(groupText, "### ");
    const heading = groupText.slice(0, boxCuts[0] ?? groupText.length);
    const group = { heading, title: heading.split("\n")[0].replace(/^## /u, ""), boxes: [] };
    const boxBounds = [...boxCuts, groupText.length];
    for (let at = 0; at < boxCuts.length; at += 1) {
      const text = groupText.slice(boxBounds[at], boxBounds[at + 1]);
      const match = BOX_HEADING.exec(text.split("\n")[0]);
      if (!match) throw new TherapyProtocolUnavailableError(`A box heading in ${BOX_GUIDANCE_FILE} has no ID: ${text.split("\n")[0].slice(0, 80)}`);
      if (boxes.some((box) => box.id === match[1])) throw new TherapyProtocolUnavailableError(`The box ${match[1]} appears twice in ${BOX_GUIDANCE_FILE}.`);
      const box = { id: match[1], title: match[2], text };
      boxes.push(box);
      group.boxes.push(box);
    }
    groups.push(group);
  }
  const rebuilt = opening + groups.map((group) => group.heading + group.boxes.map((box) => box.text).join("")).join("");
  if (rebuilt !== content) throw new TherapyProtocolUnavailableError(`The packaged ${BOX_GUIDANCE_FILE} could not be split into boxes exactly.`);
  return { opening, groups, boxes };
}

// The box list: the box file's opening, byte for byte, then each group's heading as written and its boxes by name.
function boxListText(opening, groups) {
  const lines = [
    opening.replace(/\n*$/u, "\n"),
    "Each box's advice is its own part, loaded by name with load_therapy_protocol before you use that box (several boxes in one call is fine):",
    ""
  ];
  for (const group of groups) {
    lines.push(group.heading.replace(/\n*$/u, ""), "");
    for (const box of group.boxes) lines.push(`- \`${BOX_PART_PREFIX}${box.id}\`: ${box.title}`);
    lines.push("");
  }
  return lines.join("\n");
}

function makePart(name, label, content, source) {
  return Object.freeze({ name, label, content, bytes: bytesOf(content), sha256: sha256(content), source });
}

// One or more parts for a text: one named `name` when it fits, else `name/1`, `name/2`... in order.
function namedPieces(name, content, source) {
  const pieces = textPieces(content, PROTOCOL_PART_MAX_BYTES);
  return pieces.map((piece, index) => (pieces.length === 1
    ? makePart(name, name, piece, source)
    : makePart(`${name}/${index + 1}`, `${name}/${index + 1} of ${pieces.length}`, piece, source)));
}

const deliveries = new WeakMap();

// Everything a host can load from this protocol, in reading order, what the first answer holds and the groups to load
// before the first reply.
export function therapyProtocolDelivery(protocol) {
  const cached = deliveries.get(protocol);
  if (cached) return cached;
  const rules = namedPieces("rules", protocol.instructions, "SKILL.md");
  // The rules' parts are always numbered, even when there is one, so the first answer can name the rest the same way.
  const numberedRules = rules.length === 1 ? [makePart(`${RULES_PART_PREFIX}1`, `${RULES_PART_PREFIX}1 of 1`, rules[0].content, "SKILL.md")] : rules;
  const references = [];
  const aliases = new Map([["rules", numberedRules.map((part) => part.name)], ["instructions", numberedRules.map((part) => part.name)], ["SKILL.md", numberedRules.map((part) => part.name)]]);
  let boxList = [];
  const boxes = [];
  for (const file of protocol.files) {
    if (file.path === BOX_GUIDANCE_FILE) {
      const { opening, groups, boxes: sections } = boxSections(file.content);
      boxList = namedPieces(BOX_LIST_PART, boxListText(opening, groups), file.path);
      aliases.set(BOX_LIST_PART, boxList.map((part) => part.name));
      for (const box of sections) {
        const parts = namedPieces(`${BOX_PART_PREFIX}${box.id}`, box.text, file.path);
        boxes.push(...parts);
        aliases.set(`${BOX_PART_PREFIX}${box.id}`, parts.map((part) => part.name));
        aliases.set(box.id, parts.map((part) => part.name));
      }
      aliases.set(file.path, boxList.map((part) => part.name));
      aliases.set(file.path.slice(REFERENCE_PREFIX.length), boxList.map((part) => part.name));
      continue;
    }
    const parts = namedPieces(file.path, file.content, file.path);
    references.push(...parts);
    aliases.set(file.path, parts.map((part) => part.name));
    aliases.set(file.path.slice(REFERENCE_PREFIX.length), parts.map((part) => part.name));
  }
  const missing = boxList.length > 0 ? SAFETY_BOX_IDS.filter((id) => !aliases.has(id)) : [];
  if (missing.length > 0) throw new TherapyProtocolUnavailableError(`The packaged ${BOX_GUIDANCE_FILE} lacks a safety box: ${missing.join(", ")}.`);
  const safetyBoxes = boxList.length > 0 ? SAFETY_BOX_IDS.flatMap((id) => aliases.get(id)) : [];
  const all = [...numberedRules, ...references, ...boxList, ...boxes];
  const byName = new Map(all.map((part) => [part.name, part]));
  const order = new Map(all.map((part, index) => [part.name, index]));
  const delivery = { protocol, rules: numberedRules, references, boxList, boxes, all, byName, aliases, firstNames: [], groups: [], groupNames: [] };
  // Everything before the first reply, most urgent first: the rest of the rules, the box list (with its rule to keep the
  // safer reading), the safety boxes and the protective-compatibility file in that order, then the other always-read
  // files, largest first, wherever they fit.
  const before = [
    ...numberedRules.map((part) => part.name),
    ...boxList.map((part) => part.name),
    ...safetyBoxes,
    ...references.filter((part) => EARLY_FILES.includes(part.source)).map((part) => part.name),
    ...references.filter((part) => !ON_REQUEST_FILES.has(part.source) && !EARLY_FILES.includes(part.source)).map((part) => part.name)
  ];
  const urgent = new Set(before.filter((name) => !references.some((part) => part.name === name && !EARLY_FILES.includes(part.source))));
  const pack = (firstNames) => {
    const groups = [];
    const fits = (names) => packAnswer(delivery, names, []).stillToLoad.length === 0;
    for (const name of before.filter((candidate) => !firstNames.includes(candidate) && urgent.has(candidate))) {
      const last = groups.at(-1);
      if (last && fits([...last, name])) last.push(name); else groups.push([name]);
    }
    const others = before.filter((name) => !firstNames.includes(name) && !urgent.has(name))
      .sort((a, b) => byName.get(b).bytes - byName.get(a).bytes || order.get(a) - order.get(b));
    for (const name of others) {
      const group = groups.find((candidate) => fits([...candidate, name]));
      if (group) group.push(name); else groups.push([name]);
    }
    return groups;
  };
  // The first answer: as many of the rules' parts, in order, as fit beside its own lines at their longest (the group list
  // and a note that the protocol has changed), so no first answer is ever over the cap.
  let firstNames = [];
  let groups = [];
  for (let count = numberedRules.length; count >= 1; count -= 1) {
    const candidate = numberedRules.slice(0, count).map((part) => part.name);
    const candidateGroups = pack(candidate);
    if (count === 1 || bytesOf(renderFirstAnswer(delivery, candidate, candidateGroups, "f".repeat(64))) <= PROTOCOL_ANSWER_MAX_BYTES) {
      firstNames = candidate;
      groups = candidateGroups;
      break;
    }
  }
  if (bytesOf(renderFirstAnswer(delivery, firstNames, groups, "f".repeat(64))) > PROTOCOL_ANSWER_MAX_BYTES) {
    throw new TherapyProtocolUnavailableError("The first part of the rules doesn't fit in one answer.");
  }
  groups.forEach((group) => group.sort((a, b) => order.get(a) - order.get(b)));
  delivery.firstNames = Object.freeze(firstNames);
  delivery.groups = Object.freeze(groups.map((group) => Object.freeze(group)));
  delivery.groupNames = Object.freeze(groups.map((_, index) => `${GROUP_PREFIX}${index + 1}`));
  groups.forEach((group, index) => aliases.set(`${GROUP_PREFIX}${index + 1}`, group));
  // Every part fits in an answer beside the shortest form of an answer's own lines at their longest: 40 of the longest
  // part names still to load, more beyond them, and unknown names counted. packAnswer falls back to that form when
  // nothing else fits, so any request naming a part gets at least that part.
  const longestNames = [...all].sort((a, b) => b.name.length - a.name.length).slice(0, MAX_LISTED_PARTS).map((part) => part.name);
  for (const part of all) {
    if (bytesOf(renderPartsAnswer(delivery, [part], longestNames, ["x", "y"], 1, true)) > PROTOCOL_ANSWER_MAX_BYTES) {
      throw new TherapyProtocolUnavailableError(`The part ${part.name} doesn't fit in one answer.`);
    }
  }
  const frozen = Object.freeze(delivery);
  deliveries.set(protocol, frozen);
  return frozen;
}

function block(part) {
  return `<<<BEGIN ${part.label} sha256=${part.sha256} bytes=${part.bytes}>>>\n${part.content}${part.content.endsWith("\n") ? "" : "\n"}<<<END ${part.label}>>>`;
}

const header = (protocol) => `InnerSignal therapy protocol ${protocol.version} (sha256 ${protocol.protocolSha256})`;
const nameList = (names) => `[${names.map((name) => JSON.stringify(name)).join(", ")}]`;

function loadingNote(delivery) {
  const exampleBox = delivery.boxes[0]?.name;
  return [
    "This is the first part of InnerSignal's therapy rules. The rest comes in parts, so that every app shows each answer whole: apps cut long tool results.",
    "Before your first reply, load every group listed below: one call to load_therapy_protocol per group (the calls may run at the same time), with `parts` set to a list holding the group's name, such as `[\"group/1\"]`, and `protocol_sha256` set to the sha256 above. Then follow the rules and their files.",
    "One exception: if the person says they want to die, may act on it or has already taken something, reply at once from the section on someone who may want to die, which this answer holds in full, and load the groups before your next reply.",
    "Paths such as `references/FOCUS-DISCIPLINE.md` in the rules are part names.",
    ...(delivery.boxList.length > 0 ? [`The map's boxes: before you use a box, load its advice by its name from the box list (\`box/\` and the box's ID, for example \`${exampleBox}\`); several in one call is fine.`] : []),
    "Load `references/GUIDE-REFERRALS.md` when the rules say to.",
    "Send `protocol_sha256` with every call; if an answer says the protocol has changed, start again from that answer. In a long chat, if you can no longer see a part you need, load it again. If an answer looks cut off or says it was shortened, ask again for fewer parts at a time.",
    "If load_therapy_protocol has no `parts` input among your tools, the app holds an older tool list for this connector and can't load the rest: tell the user that InnerSignal needs its connector's tools refreshed in the app's settings before it can help with this, and don't give the therapy from this part alone or from memory. If the person may want to die, follow the section on that in this answer first, and leave the refresh for later.",
    "Record `version` and `protocol_sha256` with any continuity handoff. Never mention the parts, the map or the boxes to the person."
  ].join(" ");
}

function groupLines(delivery, groups) {
  return groups.map((group, index) => `- \`${GROUP_PREFIX}${index + 1}\`: ${group.join(", ")}`);
}

function renderFirstAnswer(delivery, firstNames, groups, changedFrom = null) {
  const lines = [header(delivery.protocol)];
  if (changedFrom) {
    lines.push("", `The protocol has changed since the answer whose sha256 you sent (${changedFrom}): what you loaded from it may differ. Start again from this answer.`);
  }
  lines.push("", loadingNote(delivery), "");
  if (groups.length === 0) lines.push("Before your first reply, load: nothing more; this answer holds all of the rules.");
  else lines.push("Load before your first reply, one call per group, by the group's name:", ...groupLines(delivery, groups));
  lines.push("", ...firstNames.map((name) => block(delivery.byName.get(name))));
  return lines.join("\n");
}

// `brief` keeps the answer's own lines at their shortest: the names still to load (real part names, at most 40) and
// counts, with no echo of unknown names and no list of groups.
function renderPartsAnswer(delivery, parts, stillToLoad, unknown, beyond = 0, brief = false) {
  const asked = parts.length + stillToLoad.length + beyond;
  const opening = asked === 0
    ? `${header(delivery.protocol)}: none of the names you sent is a part of this protocol.`
    : `${header(delivery.protocol)}: ${stillToLoad.length + beyond === 0 ? "the parts you asked for." : `${parts.length} of the ${asked} parts you asked for; the rest didn't fit in one answer.`}`;
  const lines = [opening];
  if (stillToLoad.length > 0) lines.push(`Still to load (ask for these in another call): ${nameList(stillToLoad.slice(0, MAX_LISTED_PARTS))}`);
  if (stillToLoad.length > MAX_LISTED_PARTS || beyond > 0) {
    lines.push(`And ${stillToLoad.length - Math.min(stillToLoad.length, MAX_LISTED_PARTS) + beyond} more parts after those: ask for them by name once you have loaded these (a part's name and number are in its BEGIN line).`);
  }
  if (unknown.length > 0 && brief) lines.push(`${unknown.length} of the names you sent ${unknown.length === 1 ? "is not a part name" : "are not part names"}: the first answer and the box list give the names.`);
  if (unknown.length > 0 && !brief) {
    const shown = unknown.slice(0, MAX_ECHOED_UNKNOWN).map(echoedName);
    const groups = delivery.groupNames ?? [];
    const groupNames = groups.length === 0 ? "" : groups.length === 1 ? `the group \`${groups[0]}\`, ` : `the groups \`${groups[0]}\` to \`${groups.at(-1)}\`, `;
    lines.push(`Not part names of this protocol: ${nameList(shown)}${unknown.length > shown.length ? ` and ${unknown.length - shown.length} more` : ""}. The names are ${groupNames}the paths the rules name, \`${BOX_LIST_PART}\`, and each box's name from the box list.`);
  }
  lines.push("", ...parts.map(block));
  return lines.join("\n");
}

const WRAPPERS = /^[\s"'`[\]()]+|[\s"'`[\]()]+$/gu;

// An unknown name as an answer echoes it: plain letters, digits and `._/ -` kept, anything else shown as `?`, cut at 60
// characters, so its echo can never crowd the parts out of an answer.
function echoedName(name) {
  const plain = name.replace(/[^A-Za-z0-9._/ -]/gu, "?");
  return plain.length > 60 ? `${plain.slice(0, 60)}…` : plain;
}

// A requested name as the parts it stands for, or null. Exact names and aliases first (a group, a whole file, a
// reference's file name, a box ID without `box/`, the rules), then the same ignoring case, quotes, brackets, a leading
// `./`, a missing `.md` or `references/`, `boxes/` for `box/`, and a bare group number.
function resolveName(delivery, raw) {
  const direct = (name) => (delivery.byName.has(name) ? [name] : delivery.aliases.get(name) ?? null);
  const name = raw.replace(WRAPPERS, "").replace(/^\.\//u, "");
  const candidates = [name, name.replace(/^boxes\//iu, BOX_PART_PREFIX), `${name}.md`, `${REFERENCE_PREFIX}${name}`, `${REFERENCE_PREFIX}${name}.md`];
  const group = /^(?:group[ /]?)?(\d{1,2})$/iu.exec(name);
  if (group) candidates.push(`${GROUP_PREFIX}${Number(group[1])}`);
  for (const candidate of candidates) {
    const found = direct(candidate);
    if (found) return found;
  }
  const lower = new Map([...delivery.byName.keys(), ...delivery.aliases.keys()].map((key) => [key.toLowerCase(), key]));
  for (const candidate of candidates) {
    const key = lower.get(candidate.toLowerCase());
    if (key !== undefined) return direct(key);
  }
  return null;
}

// `parts` as the list of names it means: a list of strings, or one string holding a JSON list or names separated by
// commas or spaces.
function requestedNames(parts) {
  if (typeof parts === "string") {
    const text = parts.trim();
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return requestedNames(parsed);
      } catch { /* read it as names separated by commas or spaces */ }
    }
    return text.split(/[\s,]+/u).filter((name) => name.replace(WRAPPERS, "") !== "");
  }
  if (!Array.isArray(parts) || parts.some((name) => typeof name !== "string" || name.length > 200)) {
    throw new ProtocolRequestError("`parts` must be a list of part names, as the first answer and the box list give them.");
  }
  return parts.filter((name) => name.replace(WRAPPERS, "") !== "");
}

function validatedRequest(args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new ProtocolRequestError("The arguments must be an object.");
  const parts = args.parts === undefined ? [] : requestedNames(args.parts);
  if (parts.length > MAX_REQUESTED_PARTS) throw new ProtocolRequestError(`Ask for at most ${MAX_REQUESTED_PARTS} parts in one call.`);
  const requestedSha = args.protocol_sha256 === undefined ? null : typeof args.protocol_sha256 === "string" ? args.protocol_sha256.trim().toLowerCase() : args.protocol_sha256;
  if (requestedSha !== null && (typeof requestedSha !== "string" || !/^[0-9a-f]{64}$/u.test(requestedSha))) {
    throw new ProtocolRequestError("`protocol_sha256` must be the 64-character sha256 from the first answer.");
  }
  return { parts, requestedSha };
}

// The text load_therapy_protocol returns for these arguments. Without `parts`, the first answer; with them, as many of
// the named parts as fit in one answer and the names of the rest. A `protocol_sha256` that isn't the one served now gets
// the first answer again, saying the protocol has changed.
export function therapyProtocolAnswer(protocol, args = {}) {
  const { parts, requestedSha } = validatedRequest(args);
  const delivery = therapyProtocolDelivery(protocol);
  if (requestedSha !== null && requestedSha !== protocol.protocolSha256) {
    return { text: renderFirstAnswer(delivery, delivery.firstNames, delivery.groups, requestedSha), included: [...delivery.firstNames], stillToLoad: [], unknown: [] };
  }
  if (parts.length === 0) return { text: renderFirstAnswer(delivery, delivery.firstNames, delivery.groups), included: [...delivery.firstNames], stillToLoad: [], unknown: [] };
  const expanded = [];
  const unknown = [];
  for (const name of parts) {
    const resolved = resolveName(delivery, name);
    if (resolved === null) { if (!unknown.includes(name)) unknown.push(name); continue; }
    for (const partName of resolved) if (!expanded.includes(partName)) expanded.push(partName);
  }
  // A request whose names stand for more than 40 parts is answered from its first 40; the answer says how many more.
  const wanted = expanded.slice(0, MAX_REQUESTED_PARTS);
  const beyond = expanded.length - wanted.length;
  const { included, stillToLoad, text } = packAnswer(delivery, wanted, unknown, beyond);
  return { text, included, stillToLoad: [...stillToLoad, ...expanded.slice(MAX_REQUESTED_PARTS)], unknown };
}

// Which of the wanted parts go in one answer: each part in the order asked that still fits; one that doesn't is named
// as still to load, and a smaller one after it may still go in. A part is measured with every wanted part not yet taken
// listed as still to load, the longest that list can be, so the answer as sent is never longer than what was measured.
// At most 40 parts are wanted and at most 40 named as still to load, so the answer's own lines stay short and the first
// wanted part always fits (checked for every part when the protocol loads).
function packAnswer(delivery, wanted, unknown, beyond = 0) {
  const partsOf = (names) => names.map((name) => delivery.byName.get(name));
  const included = [];
  for (const name of wanted) {
    const trial = [...included, name];
    const rest = wanted.filter((other) => !trial.includes(other));
    if (bytesOf(renderPartsAnswer(delivery, partsOf(trial), rest, unknown, beyond)) <= PROTOCOL_ANSWER_MAX_BYTES) included.push(name);
  }
  if (included.length === 0 && wanted.length > 0) {
    // The answer's own lines left no room for any part: the first part goes out with those lines at their shortest, which
    // every part was checked to fit beside when the protocol loaded. So a request naming a real part always gets one.
    const rest = wanted.slice(1);
    return { included: [wanted[0]], stillToLoad: rest, text: renderPartsAnswer(delivery, partsOf([wanted[0]]), rest, unknown, beyond, true) };
  }
  const stillToLoad = wanted.filter((name) => !included.includes(name));
  return { included, stillToLoad, text: renderPartsAnswer(delivery, partsOf(included), stillToLoad, unknown, beyond) };
}
