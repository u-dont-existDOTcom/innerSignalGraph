// InnerSignal in parts (owner answer i60a, 21 Nov 2026): every answer of load_therapy_protocol is small enough for any app
// to show whole, the first one holds the start of the rules with the whole section on someone who may want to die, and the
// rest arrives byte for byte in the groups the first answer lists, or one box at a time when a box is used.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import {
  BOX_LIST_PART,
  BOX_PART_PREFIX,
  PROTOCOL_ANSWER_MAX_BYTES,
  PROTOCOL_PART_MAX_BYTES,
  SAFETY_BOX_IDS,
  loadTherapyProtocol,
  textPieces,
  therapyProtocolAnswer,
  therapyProtocolDelivery,
  therapyProtocolManifest
} from "../src/protocol/therapy-protocol.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const bytes = (text) => Buffer.byteLength(text, "utf8");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const BOX_FILE = "references/INNER-CHILD-BOX-GUIDANCE.md";
const ON_REQUEST = "references/GUIDE-REFERRALS.md";
const protocol = loadTherapyProtocol();
const delivery = therapyProtocolDelivery(protocol);

function blockBody(text, part) {
  const begin = `<<<BEGIN ${part.label} sha256=${part.sha256} bytes=${part.bytes}>>>\n`;
  const start = text.indexOf(begin);
  if (start === -1) return null;
  const bodyStart = start + begin.length;
  const body = text.slice(bodyStart, text.indexOf(`<<<END ${part.label}>>>`, bodyStart));
  return part.content.endsWith("\n") ? body : body.slice(0, -1);
}

test("every answer fits in one app's view: the first, each group, every single part, and a request for everything", () => {
  const answers = [therapyProtocolAnswer(protocol, {}), ...delivery.groups.map((parts) => therapyProtocolAnswer(protocol, { parts }))];
  for (const part of delivery.all) answers.push(therapyProtocolAnswer(protocol, { parts: [part.name] }));
  answers.push(therapyProtocolAnswer(protocol, { parts: delivery.all.slice(0, 40).map((part) => part.name) }));
  answers.push(therapyProtocolAnswer(protocol, { protocol_sha256: "0".repeat(64) }));
  // The longest lines an answer can carry: 40 names, most unknown and long, around the largest part.
  const largest = [...delivery.all].sort((a, b) => b.bytes - a.bytes)[0];
  answers.push(therapyProtocolAnswer(protocol, { parts: [largest.name, ...Array.from({ length: 39 }, (_, index) => `${"x".repeat(190)}${index}`)] }));
  answers.push(therapyProtocolAnswer(protocol, { parts: [...delivery.boxes.slice(0, 39).map((part) => part.name), largest.name] }));
  for (const answer of answers) assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES, `${bytes(answer.text)} bytes`);
  // A single part always fits, so a request never comes back empty while it names a real part.
  for (const part of delivery.all) assert.ok(part.bytes <= PROTOCOL_PART_MAX_BYTES, part.name);
  assert.ok(answers.at(-2).included.includes(largest.name), "the largest part fits beside the longest lines");
  // Each group listed in the first answer fits whole, so loading the groups leaves nothing still to load.
  for (const parts of delivery.groups) assert.deepEqual(therapyProtocolAnswer(protocol, { parts }).stillToLoad, []);
});

test("the first answer holds the start of the rules and the whole section on someone who may want to die", () => {
  const first = therapyProtocolAnswer(protocol, {}).text;
  assert.ok(first.startsWith(`InnerSignal therapy protocol ${protocol.version} (sha256 ${protocol.protocolSha256})\n`));
  const start = protocol.instructions.indexOf("## When someone may want to die");
  const end = protocol.instructions.indexOf("\n## ", start + 1);
  assert.ok(start > 0 && end > start);
  const rules = delivery.firstNames.map((name) => blockBody(first, delivery.byName.get(name))).join("");
  assert.ok(protocol.instructions.startsWith(rules), "the rules from their first byte");
  assert.ok(rules.length >= end, "through the end of the crisis section");
  // It says how to load the rest: each group, in order, exactly as a call should send it.
  delivery.groups.forEach((group, index) => assert.ok(first.includes(`\n${index + 1}. ${JSON.stringify(group).replaceAll(",", ", ")}`), `group ${index + 1}`));
  assert.match(first, /Before your first reply, load every group listed below/u);
  assert.match(first, /has no `parts` input among your tools, the app holds an older tool list/u);
});

test("the parts rebuild every served file byte for byte, and every part's hash is its text's", () => {
  assert.equal(delivery.rules.map((part) => part.content).join(""), protocol.instructions);
  for (const file of protocol.files.filter((file) => file.path !== BOX_FILE)) {
    assert.equal(delivery.references.filter((part) => part.source === file.path).map((part) => part.content).join(""), file.content, file.path);
  }
  const box = protocol.files.find((file) => file.path === BOX_FILE);
  for (const part of delivery.boxes) assert.ok(box.content.includes(part.content), part.name);
  assert.equal(delivery.boxes.reduce((sum, part) => sum + part.bytes, 0) + bytes(box.content.slice(0, box.content.indexOf("\n## ") + 1)) <= bytes(box.content), true);
  for (const part of delivery.all) {
    assert.equal(part.sha256, sha256(part.content), part.name);
    assert.equal(part.bytes, bytes(part.content), part.name);
  }
  // Each box's part is its section exactly, from its heading to the next.
  const sections = box.content.split(/\n(?=### )/u).slice(1).map((section) => section.replace(/\n## [\s\S]*$/u, "\n"));
  assert.equal(delivery.boxes.length, sections.length);
  delivery.boxes.forEach((part, index) => assert.equal(part.content.trimEnd(), sections[index].trimEnd(), part.name));
  // The manifest names every part with its hash, and how the first answer and the groups are made up.
  const manifest = therapyProtocolManifest(protocol);
  assert.deepEqual(manifest.parts.map((part) => part.name), delivery.all.map((part) => part.name));
  assert.deepEqual(manifest.first_answer, [...delivery.firstNames]);
  assert.deepEqual(manifest.load_before_first_reply, delivery.groups.map((group) => [...group]));
});

test("before the first reply: the rules, every file the rules say to read before responding, the box list and the safety boxes", () => {
  const before = [...delivery.firstNames, ...delivery.groups.flat()];
  assert.equal(new Set(before).size, before.length, "nothing loaded twice");
  const sentence = /^Read (.+) before responding\.$/mu.exec(protocol.instructions);
  assert.ok(sentence, "the rules' read-before-responding sentence");
  const named = [...sentence[1].matchAll(/`(references\/[^`]+)`/gu)].map((match) => match[1]);
  assert.ok(!named.includes(BOX_FILE), "the box file is read a box at a time (i60a)");
  const referencesBefore = delivery.references.filter((part) => before.includes(part.name)).map((part) => part.source);
  assert.deepEqual([...new Set(referencesBefore)].sort(), [...named].sort());
  for (const part of delivery.rules) assert.ok(before.includes(part.name), part.name);
  assert.ok(before.includes(BOX_LIST_PART));
  for (const id of SAFETY_BOX_IDS) assert.ok(before.includes(`${BOX_PART_PREFIX}${id}`), id);
  assert.ok(!before.some((name) => delivery.byName.get(name).source === ON_REQUEST), "the guide referrals wait until the rules call for them");
  const others = delivery.boxes.filter((part) => !SAFETY_BOX_IDS.some((id) => part.name === `${BOX_PART_PREFIX}${id}`));
  assert.ok(others.length > 0 && others.every((part) => !before.includes(part.name)), "every other box waits until it's used");
  // The rest of the rules and the safety boxes come in the first group.
  assert.ok(delivery.rules.slice(delivery.firstNames.length).every((part) => delivery.groups[0].includes(part.name)));
  for (const id of SAFETY_BOX_IDS) assert.ok(delivery.groups[0].includes(`${BOX_PART_PREFIX}${id}`), id);
  // The rules tell a model to read a box's section before using it.
  assert.match(protocol.instructions, /`references\/INNER-CHILD-BOX-GUIDANCE\.md` \(one section per box\): read a box's section before you use that box\./u);
});

test("the safety boxes are the compiled map's tier 1, and the crisis section's boxes are among them", async () => {
  const graph = JSON.parse(await fs.readFile(path.join(root, "guide-graphs/compiled/inner-child-directed-graph.json"), "utf8"));
  const tierOne = graph.nodes.filter((node) => node.tier === 1).map((node) => node.id);
  assert.deepEqual([...SAFETY_BOX_IDS].sort(), [...tierOne].sort());
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  assert.match(titles.get("IC.SUICIDAL_ADULT_SEAT"), /adult or witness seat/u);
  assert.match(titles.get("IC.SUICIDAL_SELF_DEATH_INQUIRY"), /self\/death/u);
  assert.match(titles.get("IC.PRECIOUS_HUMAN_OPPORTUNITY"), /precious/u);
  assert.match(protocol.instructions, /the boxes on the adult seat, the self\/death inquiry and this precious human life/u);
});

test("the box list names every box once, and every box the map shows", () => {
  const list = delivery.byName.get(BOX_LIST_PART).content;
  for (const part of delivery.boxes) assert.equal(list.split(`\`${part.name}\``).length - 1, 1, part.name);
  const map = protocol.files.find((file) => file.path === "references/INNER-CHILD-THERAPY-MAP.md").content;
  for (const [, id] of map.matchAll(/\["((?:IC|ROUTE)\.[A-Z0-9_]+)<br\/>/gu)) assert.ok(delivery.byName.has(`${BOX_PART_PREFIX}${id}`), id);
  assert.match(list, /Do not mention boxes, their IDs or the map to the person\./u);
  // The first answer's example box is a real one.
  const example = /for example `(box\/[^`]+)`/u.exec(therapyProtocolAnswer(protocol, {}).text)[1];
  assert.ok(delivery.byName.has(example));
});

test("names resolve leniently, unknown ones are reported, and the rest waits for the next call", () => {
  const byAlias = therapyProtocolAnswer(protocol, { parts: ["FOCUS-DISCIPLINE.md", "IC.MEET_GUARD", "rules", " `box/IC.NEUTRAL_WITNESS` ", "no-such-part"] });
  assert.ok(byAlias.included.includes("references/FOCUS-DISCIPLINE.md"));
  assert.ok(byAlias.included.includes("box/IC.MEET_GUARD"));
  assert.deepEqual(byAlias.unknown, ["no-such-part"]);
  assert.match(byAlias.text, /Not part names of this protocol \(the first answer and the box list give the names\): \["no-such-part"\]/u);
  const wanted = [...delivery.rules.map((part) => part.name), "references/FOCUS-DISCIPLINE.md", "box/IC.MEET_GUARD", "box/IC.NEUTRAL_WITNESS"];
  assert.deepEqual([...byAlias.included, ...byAlias.stillToLoad].sort(), [...wanted].sort());
  if (byAlias.stillToLoad.length > 0) assert.match(byAlias.text, /Still to load \(ask for these in another call\): \[/u);
  // The whole box file stands for the box list.
  assert.deepEqual(therapyProtocolAnswer(protocol, { parts: [BOX_FILE] }).included, [BOX_LIST_PART]);
  // A request naming too much gets what fits and the names of the rest, never a cut part.
  const everything = therapyProtocolAnswer(protocol, { parts: delivery.all.slice(0, 40).map((part) => part.name) });
  assert.ok(everything.included.length > 0 && everything.stillToLoad.length > 0);
  for (const name of everything.included) assert.equal(blockBody(everything.text, delivery.byName.get(name)), delivery.byName.get(name).content);
});

test("a changed protocol says so and starts again from the first answer", () => {
  const changed = therapyProtocolAnswer(protocol, { parts: ["rules/2"], protocol_sha256: "a".repeat(64) });
  assert.match(changed.text, /The protocol has changed since the answer whose sha256 you sent \(a{64}\)/u);
  assert.ok(changed.text.includes(`InnerSignal therapy protocol ${protocol.version} (sha256 ${protocol.protocolSha256})`));
  assert.deepEqual(changed.included, [...delivery.firstNames]);
  const same = therapyProtocolAnswer(protocol, { parts: ["rules/2"], protocol_sha256: protocol.protocolSha256 });
  assert.deepEqual(same.included, ["rules/2"]);
});

test("with the box advice switched off, nothing points to boxes", () => {
  const off = loadTherapyProtocol({ boxGuidance: false });
  const offDelivery = therapyProtocolDelivery(off);
  assert.equal(offDelivery.boxList, null);
  assert.deepEqual(offDelivery.boxes, []);
  const texts = [therapyProtocolAnswer(off, {}).text, ...offDelivery.groups.map((parts) => therapyProtocolAnswer(off, { parts }).text)];
  for (const text of texts) {
    assert.ok(bytes(text) <= PROTOCOL_ANSWER_MAX_BYTES);
    assert.doesNotMatch(text, /box\/|INNER-CHILD-BOX-GUIDANCE/u);
  }
  assert.doesNotMatch(off.instructions, /one section per box/u);
  assert.match(off.instructions, /Use the boxes that fit this person and this moment, not all of them as a checklist\./u);
});

test("the text is cut only at headings, paragraphs or lines while they work, and never loses a byte", () => {
  const sections = ["# T\n\nintro line\n\n", "## A\n\n" + "a".repeat(30) + "\n\n", "## B\n\n" + "b".repeat(30) + "\n\n", "## C\n\nc\n"];
  const text = sections.join("");
  const pieces = textPieces(text, 50);
  assert.equal(pieces.join(""), text);
  assert.ok(pieces.every((piece) => bytes(piece) <= 50));
  assert.ok(pieces.slice(1).every((piece) => piece.startsWith("## ")), "cut at level-2 headings");
  // A section too long alone is cut at its paragraphs, then lines; one long line between code points, multi-byte ones whole.
  const long = `## L\n\n${"word ".repeat(40)}\n\n${"é".repeat(70)}\n`;
  const cut = textPieces(long, 60);
  assert.equal(cut.join(""), long);
  assert.ok(cut.every((piece) => bytes(piece) <= 60));
  assert.ok(cut.every((piece) => !piece.includes("�")));
  assert.deepEqual(textPieces("short", 60), ["short"]);
});

test("over MCP: the tool takes parts and the protocol's sha256, answers in text alone, and a bad request is a readable tool error", async (t) => {
  const listener = await listenPrivateCaseMcp({ caseAccessService: { async loadCaseContext() {}, async loadCaseContextByAlias() {} }, therapyProtocol: protocol });
  t.after(() => listener.close());
  const post = async (method, params = {}) => (await fetch(listener.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  const tool = (await post("tools/list")).result.tools.find((candidate) => candidate.name === "load_therapy_protocol");
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ["parts", "protocol_sha256"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.match(tool.description, /comes in parts/u);
  const instructions = (await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result.instructions;
  assert.match(instructions, /call load_therapy_protocol, load every group of parts its first answer lists/u);
  const answer = (await post("tools/call", { name: "load_therapy_protocol", arguments: { parts: ["box/IC.MEET_GUARD"], protocol_sha256: protocol.protocolSha256 } })).result;
  assert.deepEqual(Object.keys(answer).sort(), ["content", "isError"]);
  assert.equal(answer.isError, false);
  assert.equal(blockBody(answer.content[0].text, delivery.byName.get("box/IC.MEET_GUARD")), delivery.byName.get("box/IC.MEET_GUARD").content);
  for (const args of [{ parts: "rules/2" }, { parts: [3] }, { parts: [""] }, { parts: Array(41).fill("rules/2") }, { protocol_sha256: "abc" }]) {
    const refused = (await post("tools/call", { name: "load_therapy_protocol", arguments: args })).result;
    assert.equal(refused.isError, true, JSON.stringify(args));
    assert.equal(refused.structuredContent.code, "INVALID_PROTOCOL_REQUEST");
    assert.equal(refused.structuredContent.message, refused.content[0].text.split("\n")[0]);
  }
});
