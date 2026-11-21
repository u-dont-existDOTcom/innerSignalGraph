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
// parts (the rest of the rules, a reference file, the box list, one box's advice) and get as many as fit in one answer.
// The parts are the packaged files' own text, cut at headings; nothing is reworded, and the protocol hash is unchanged.

// The most a protocol answer may hold, in UTF-8 bytes of its whole text. About 7,000 tokens: under the roughly 10,000
// tokens ChatGPT keeps of a tool result (measured on 21 Nov 2026: the first and last ~19,700 characters), with room to
// spare, and far under the 25,000 tokens Claude hosts show before they move a result to a file.
export const PROTOCOL_ANSWER_MAX_BYTES = 28_000;
// The most one part may hold. The difference is room for an answer's own text: its first line, the note on loading and
// the list of groups in the first answer, and each part's BEGIN and END lines.
export const PROTOCOL_PART_MAX_BYTES = 24_500;

export const RULES_PART_PREFIX = "rules/";
export const BOX_LIST_PART = "boxes";
export const BOX_PART_PREFIX = "box/";
// Read when the rules say so, not before the first reply.
const ON_REQUEST_FILES = new Set(["references/GUIDE-REFERRALS.md"]);
// The safety boxes, loaded before the first reply with the rules and the always-read files: tier 1 of the compiled
// inner-child map, the boxes the rules' section on someone who may want to die relies on (the adult seat, the self/death
// inquiry, this precious human life) with the outside-safety box. Every other box is loaded when it's used.
// tests/split-delivery.test.mjs checks this list against the compiled map's tier 1.
export const SAFETY_BOX_IDS = Object.freeze(["IC.SAFETY_ORIENTATION", "IC.SUICIDAL_ADULT_SEAT", "IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.PRECIOUS_HUMAN_OPPORTUNITY"]);
const MAX_REQUESTED_PARTS = 40;
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
  if (level >= CUT_LEVELS.length) {
    const pieces = [];
    let current = "";
    for (const char of text) {
      if (current !== "" && bytesOf(current) + bytesOf(char) > max) { pieces.push(current); current = ""; }
      current += char;
    }
    if (current !== "") pieces.push(current);
    return pieces;
  }
  const cuts = CUT_LEVELS[level](text);
  if (cuts.length === 0) return textPieces(text, max, level + 1);
  const units = [];
  let start = 0;
  for (const cut of [...cuts, text.length]) {
    const unit = text.slice(start, cut);
    units.push(...(bytesOf(unit) <= max ? [unit] : textPieces(unit, max, level + 1)));
    start = cut;
  }
  const pieces = [];
  let current = "";
  for (const unit of units) {
    if (current !== "" && bytesOf(current) + bytesOf(unit) > max) { pieces.push(current); current = ""; }
    current += unit;
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

const BOX_HEADING = /^### ([A-Z][A-Z0-9]*\.[A-Z0-9_]+): (.+)$/u;

// The box file as its opening text, its group headings and one section per box, each kept byte for byte; the pieces
// rebuild the file exactly, or the protocol is unavailable.
function boxSections(content) {
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

function boxListText(opening, groups) {
  const lines = [
    opening.replace(/\n*$/u, "\n"),
    "Each box's advice is its own part, loaded by name with load_therapy_protocol before you use that box (several boxes in one call is fine):",
    ""
  ];
  for (const group of groups) {
    lines.push(`${group.title}:`);
    for (const box of group.boxes) lines.push(`- \`${BOX_PART_PREFIX}${box.id}\`: ${box.title}`);
    lines.push("");
  }
  return lines.join("\n");
}

function makePart(name, label, content, source) {
  return Object.freeze({ name, label, content, bytes: bytesOf(content), sha256: sha256(content), source });
}

// One or more parts for a text: one named `name` when it fits, else `name/1`, `name/2`... in order.
function namedPieces(name, content, source, labelOf = (piece, index, count) => (count === 1 ? name : `${name}/${index + 1} of ${count}`)) {
  const pieces = textPieces(content, PROTOCOL_PART_MAX_BYTES);
  return pieces.map((piece, index) => makePart(pieces.length === 1 ? name : `${name}/${index + 1}`, labelOf(piece, index, pieces.length), piece, source));
}

const deliveries = new WeakMap();

// Everything a host can load from this protocol, in reading order, and what to load before the first reply.
export function therapyProtocolDelivery(protocol) {
  const cached = deliveries.get(protocol);
  if (cached) return cached;
  const rulesPieces = textPieces(protocol.instructions, PROTOCOL_PART_MAX_BYTES);
  const rules = rulesPieces.map((piece, index) => makePart(`${RULES_PART_PREFIX}${index + 1}`, `${RULES_PART_PREFIX}${index + 1} of ${rulesPieces.length}`, piece, "SKILL.md"));
  const references = [];
  const aliases = new Map([["rules", rules.map((part) => part.name)], ["instructions", rules.map((part) => part.name)], ["SKILL.md", rules.map((part) => part.name)]]);
  let boxList = null;
  const boxes = [];
  for (const file of protocol.files) {
    if (file.path === BOX_GUIDANCE_FILE) {
      const { opening, groups, boxes: sections } = boxSections(file.content);
      boxList = makePart(BOX_LIST_PART, BOX_LIST_PART, boxListText(opening, groups), file.path);
      for (const box of sections) {
        const parts = namedPieces(`${BOX_PART_PREFIX}${box.id}`, box.text, file.path);
        boxes.push(...parts);
        if (parts.length > 1) aliases.set(`${BOX_PART_PREFIX}${box.id}`, parts.map((part) => part.name));
        aliases.set(box.id, parts.map((part) => part.name));
      }
      aliases.set(file.path, [BOX_LIST_PART]);
      continue;
    }
    const parts = namedPieces(file.path, file.content, file.path);
    references.push(...parts);
    if (parts.length > 1) aliases.set(file.path, parts.map((part) => part.name));
    aliases.set(file.path.slice(REFERENCE_PREFIX.length), parts.map((part) => part.name));
  }
  const all = [...rules, ...references, ...(boxList ? [boxList] : []), ...boxes];
  const byName = new Map(all.map((part) => [part.name, part]));
  // The first answer: as many of the rules' parts, in order, as fit beside its own text.
  const safetyBoxes = boxList ? SAFETY_BOX_IDS.flatMap((id) => aliases.get(id) ?? []).map((name) => byName.get(name)) : [];
  if (boxList && safetyBoxes.length < SAFETY_BOX_IDS.length) {
    throw new TherapyProtocolUnavailableError(`The packaged ${BOX_GUIDANCE_FILE} lacks a safety box: ${SAFETY_BOX_IDS.filter((id) => !aliases.has(id)).join(", ")}.`);
  }
  const before = [
    ...rules,
    ...references.filter((part) => !ON_REQUEST_FILES.has(part.source)),
    ...(boxList ? [boxList] : []),
    ...safetyBoxes
  ];
  const delivery = { protocol, rules, references, boxList, boxes, all, byName, aliases, firstNames: [], groups: [] };
  const firstNames = [];
  for (const part of rules) {
    const candidate = [...firstNames, part.name];
    if (firstNames.length > 0 && bytesOf(renderFirstAnswer(delivery, candidate, [])) > PROTOCOL_ANSWER_MAX_BYTES) break;
    firstNames.push(part.name);
  }
  // The rest of what comes before the first reply, packed into groups that each fit in one answer: the rest of the
  // rules first, then the largest parts first into the first group with room. Groups list their parts in reading order.
  const remaining = before.filter((part) => !firstNames.includes(part.name));
  const order = new Map(all.map((part, index) => [part.name, index]));
  const groups = [];
  const fits = (names) => packAnswer(delivery, names, []).stillToLoad.length === 0;
  // The rest of the rules and the safety boxes go first, so an app that loads the groups in order has them earliest.
  const early = remaining.filter((part) => part.name.startsWith(RULES_PART_PREFIX) || safetyBoxes.includes(part));
  for (const part of early) {
    const last = groups.at(-1);
    if (last && fits([...last, part.name])) last.push(part.name); else groups.push([part.name]);
  }
  const others = remaining.filter((part) => !early.includes(part)).sort((a, b) => b.bytes - a.bytes || order.get(a.name) - order.get(b.name));
  for (const part of others) {
    const group = groups.find((candidate) => fits([...candidate, part.name]));
    if (group) group.push(part.name); else groups.push([part.name]);
  }
  for (const group of groups) group.sort((a, b) => order.get(a) - order.get(b));
  delivery.firstNames = Object.freeze(firstNames);
  delivery.groups = Object.freeze(groups.map((group) => Object.freeze(group)));
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
    "Before your first reply, load every group listed below: one call to load_therapy_protocol per group (the calls may run at the same time), with `parts` set to the group exactly as written and `protocol_sha256` set to the sha256 above. Then follow the rules and their files.",
    "Paths such as `references/FOCUS-DISCIPLINE.md` in the rules are part names.",
    ...(delivery.boxList ? [`The map's boxes: before you use a box, load its advice by its name from the box list (\`box/\` and the box's ID, for example \`${exampleBox}\`); several in one call is fine.`] : []),
    "Load `references/GUIDE-REFERRALS.md` when the rules say to.",
    "If an answer looks cut off or says it was shortened, ask again for fewer parts at a time.",
    "If load_therapy_protocol has no `parts` input among your tools, the app holds an older tool list for this connector: follow the rules in this answer, and tell the user to refresh the InnerSignal connector's tools in the app's settings.",
    "Record `version` and `protocol_sha256` with any continuity handoff. Never mention the parts, the map or the boxes to the person."
  ].join(" ");
}

function renderFirstAnswer(delivery, firstNames, groups, changedFrom = null) {
  const lines = [header(delivery.protocol)];
  if (changedFrom) {
    lines.push("", `The protocol has changed since the answer whose sha256 you sent (${changedFrom}): what you loaded from it may differ. Start again from this answer.`);
  }
  lines.push("", loadingNote(delivery), "");
  if (groups.length === 0) lines.push("Before your first reply, load: nothing more; this answer holds all of the rules.");
  else {
    lines.push("Load before your first reply, one call per group:");
    groups.forEach((group, index) => lines.push(`${index + 1}. ${nameList(group)}`));
  }
  lines.push("", ...firstNames.map((name) => block(delivery.byName.get(name))));
  return lines.join("\n");
}

const MAX_ECHOED_UNKNOWN = 5;

function renderPartsAnswer(delivery, parts, stillToLoad, unknown) {
  const lines = [`${header(delivery.protocol)}: ${stillToLoad.length === 0 ? "the parts you asked for." : `${parts.length} of the ${parts.length + stillToLoad.length} parts you asked for; the rest didn't fit in one answer.`}`];
  if (stillToLoad.length > 0) lines.push(`Still to load (ask for these in another call): ${nameList(stillToLoad)}`);
  if (unknown.length > 0) {
    const shown = unknown.slice(0, MAX_ECHOED_UNKNOWN).map((name) => (name.length > 60 ? `${name.slice(0, 60)}…` : name));
    lines.push(`Not part names of this protocol (the first answer and the box list give the names): ${nameList(shown)}${unknown.length > shown.length ? ` and ${unknown.length - shown.length} more` : ""}`);
  }
  if (parts.length === 0 && stillToLoad.length === 0) lines.push("No part to send.");
  lines.push("", ...parts.map(block));
  return lines.join("\n");
}

// A requested name as the parts it stands for: an exact part name, an alias (a whole file, a reference's file name, a
// box ID without `box/`, the rules), or nothing.
function resolveName(delivery, name) {
  if (delivery.byName.has(name)) return [name];
  if (delivery.aliases.has(name)) return delivery.aliases.get(name);
  const trimmed = name.trim().replace(/^`|`$/gu, "");
  if (trimmed !== name) return resolveName(delivery, trimmed);
  return null;
}

function validatedRequest(args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new ProtocolRequestError("The arguments must be an object.");
  const { parts, protocol_sha256: requestedSha } = args;
  if (parts !== undefined) {
    if (!Array.isArray(parts) || parts.some((name) => typeof name !== "string" || name.length === 0 || name.length > 200)) {
      throw new ProtocolRequestError("`parts` must be a list of part names, as the first answer and the box list give them.");
    }
    if (parts.length > MAX_REQUESTED_PARTS) throw new ProtocolRequestError(`Ask for at most ${MAX_REQUESTED_PARTS} parts in one call.`);
  }
  if (requestedSha !== undefined && (typeof requestedSha !== "string" || !/^[0-9a-f]{64}$/u.test(requestedSha))) {
    throw new ProtocolRequestError("`protocol_sha256` must be the 64-character sha256 from the first answer.");
  }
  return { parts: parts ?? [], requestedSha: requestedSha ?? null };
}

// The text load_therapy_protocol returns for these arguments. Without `parts`, the first answer; with them, as many of
// the named parts as fit in one answer, in the order asked, and the names of the rest. A `protocol_sha256` that isn't the
// one served now gets the first answer again, saying the protocol has changed.
export function therapyProtocolAnswer(protocol, args = {}) {
  const { parts, requestedSha } = validatedRequest(args);
  const delivery = therapyProtocolDelivery(protocol);
  if (requestedSha !== null && requestedSha !== protocol.protocolSha256) {
    return { text: renderFirstAnswer(delivery, delivery.firstNames, delivery.groups, requestedSha), included: [...delivery.firstNames], stillToLoad: [], unknown: [] };
  }
  if (parts.length === 0) return { text: renderFirstAnswer(delivery, delivery.firstNames, delivery.groups), included: [...delivery.firstNames], stillToLoad: [], unknown: [] };
  const wanted = [];
  const unknown = [];
  for (const name of parts) {
    const resolved = resolveName(delivery, name);
    if (resolved === null) { if (!unknown.includes(name)) unknown.push(name); continue; }
    for (const partName of resolved) if (!wanted.includes(partName)) wanted.push(partName);
  }
  const { included, stillToLoad, text } = packAnswer(delivery, wanted, unknown);
  return { text, included, stillToLoad, unknown };
}

// Which of the wanted parts go in one answer: in the order asked, each part that still fits. A part is measured with every
// wanted part not yet taken listed as still to load, the longest that list can be, so the answer as sent is never longer
// than what was measured.
function packAnswer(delivery, wanted, unknown) {
  const partsOf = (names) => names.map((name) => delivery.byName.get(name));
  const included = [];
  for (const name of wanted) {
    const trial = [...included, name];
    const rest = wanted.filter((other) => !trial.includes(other));
    if (bytesOf(renderPartsAnswer(delivery, partsOf(trial), rest, unknown)) <= PROTOCOL_ANSWER_MAX_BYTES) included.push(name);
  }
  const stillToLoad = wanted.filter((name) => !included.includes(name));
  return { included, stillToLoad, text: renderPartsAnswer(delivery, partsOf(included), stillToLoad, unknown) };
}
