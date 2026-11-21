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
  GROUP_PREFIX,
  PROTOCOL_ANSWER_MAX_BYTES,
  PROTOCOL_PART_MAX_BYTES,
  SAFETY_BOX_IDS,
  TherapyProtocolUnavailableError,
  boxSections,
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

// A protocol made up for a test: its rules, and a box file when one is given.
function syntheticProtocol(instructions, files = []) {
  return Object.freeze({
    protocolId: "inner-signal-therapy",
    version: "0.0.0-test",
    protocolSha256: sha256(instructions + files.map((file) => file.content).join("")),
    instructions,
    instructionsSha256: sha256(instructions),
    files: Object.freeze(files.map((file) => Object.freeze({ ...file, sha256: sha256(file.content), bytes: bytes(file.content) })))
  });
}

function syntheticBoxFile(ids, { titleBytes = 40, bodyBytes = 200 } = {}) {
  const box = (id) => `### ${id}: ${"T".repeat(titleBytes)}\n\n- Do: ${"d".repeat(bodyBytes)}\n\n`;
  return `# Boxes\n\nOpening text. Do not mention boxes, their IDs or the map to the person.\n\n## Inner-child boxes\n\n${ids.filter((id) => id.startsWith("IC.")).map(box).join("")}## Cross-guide routes\n\n${ids.filter((id) => id.startsWith("ROUTE.")).map(box).join("")}`;
}

test("every answer fits in one app's view: the first, each group, every single part, and a request for everything", () => {
  const answers = [therapyProtocolAnswer(protocol, {}), ...delivery.groupNames.map((name) => therapyProtocolAnswer(protocol, { parts: [name] }))];
  for (const part of delivery.all) answers.push(therapyProtocolAnswer(protocol, { parts: [part.name] }));
  answers.push(therapyProtocolAnswer(protocol, { parts: delivery.all.slice(0, 40).map((part) => part.name) }));
  answers.push(therapyProtocolAnswer(protocol, { protocol_sha256: "0".repeat(64) }));
  // The longest lines an answer can carry: 40 names, most unknown and long, around the largest part.
  const largest = [...delivery.all].sort((a, b) => b.bytes - a.bytes)[0];
  answers.push(therapyProtocolAnswer(protocol, { parts: [largest.name, ...Array.from({ length: 39 }, (_, index) => `${"x".repeat(190)}${index}`)] }));
  answers.push(therapyProtocolAnswer(protocol, { parts: [...delivery.boxes.slice(0, 39).map((part) => part.name), largest.name] }));
  for (const answer of answers) assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES, `${bytes(answer.text)} bytes`);
  for (const part of delivery.all) assert.ok(part.bytes <= PROTOCOL_PART_MAX_BYTES, part.name);
  assert.ok(answers.at(-2).included.includes(largest.name), "the largest part fits beside the longest lines");
  // Each group the first answer lists fits whole, so loading the groups leaves nothing still to load.
  delivery.groupNames.forEach((name, index) => {
    const answer = therapyProtocolAnswer(protocol, { parts: [name] });
    assert.deepEqual(answer.stillToLoad, []);
    assert.deepEqual(answer.included, [...delivery.groups[index]]);
  });
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
  // It names each group to load before the first reply, with what is in it.
  delivery.groups.forEach((group, index) => assert.ok(first.includes(`\n- \`${GROUP_PREFIX}${index + 1}\`: ${group.join(", ")}`), `group ${index + 1}`));
  assert.match(first, /Before your first reply, load every group listed below: one call to load_therapy_protocol per group \(the calls may run at the same time\), with `parts` set to a list holding the group's name, such as `\["group\/1"\]`/u);
  // Someone who may want to die gets a reply at once, from the section this answer holds in full.
  assert.match(first, /if the person says they want to die, may act on it or has already taken something, reply at once from the section on someone who may want to die, which this answer holds in full, and load the groups before your next reply\./u);
  // An app holding the old tool list: no therapy from this part alone, the crisis section first, the refresh after.
  assert.match(first, /has no `parts` input among your tools, the app holds an older tool list for this connector and can't load the rest/u);
  assert.match(first, /don't give the therapy from this part alone or from memory\. If the person may want to die, follow the section on that in this answer first, and leave the refresh for later\./u);
  assert.match(first, /Send `protocol_sha256` with every call/u);
  assert.match(first, /if you can no longer see a part you need, load it again/u);
});

test("the parts rebuild the rules and every reference byte for byte, the boxes exactly, and every hash is its text's", () => {
  assert.equal(delivery.rules.map((part) => part.content).join(""), protocol.instructions);
  for (const file of protocol.files.filter((file) => file.path !== BOX_FILE)) {
    assert.equal(delivery.references.filter((part) => part.source === file.path).map((part) => part.content).join(""), file.content, file.path);
  }
  // The box file is its opening, its group headings and its boxes' sections, exactly; each box's part is its section.
  const box = protocol.files.find((file) => file.path === BOX_FILE);
  const { opening, groups, boxes } = boxSections(box.content);
  assert.equal(opening + groups.map((group) => group.heading + group.boxes.map((entry) => entry.text).join("")).join(""), box.content);
  assert.deepEqual(delivery.boxes.map((part) => part.content), boxes.map((entry) => entry.text));
  // The box list carries the opening byte for byte and each group heading as written.
  const list = delivery.boxList.map((part) => part.content).join("");
  assert.ok(list.startsWith(opening.replace(/\n*$/u, "\n")));
  for (const group of groups) assert.ok(list.includes(group.heading.replace(/\n*$/u, "")), group.title);
  assert.throws(() => boxSections(box.content.replace("### IC.MEET_GUARD:", "### meet guard:")), TherapyProtocolUnavailableError);
  for (const part of delivery.all) {
    assert.equal(part.sha256, sha256(part.content), part.name);
    assert.equal(part.bytes, bytes(part.content), part.name);
  }
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
  for (const part of [...delivery.rules, ...delivery.boxList]) assert.ok(before.includes(part.name), part.name);
  for (const id of SAFETY_BOX_IDS) assert.ok(before.includes(`${BOX_PART_PREFIX}${id}`), id);
  assert.ok(!before.some((name) => delivery.byName.get(name).source === ON_REQUEST), "the guide referrals wait until the rules call for them");
  const others = delivery.boxes.filter((part) => !SAFETY_BOX_IDS.some((id) => part.name === `${BOX_PART_PREFIX}${id}`));
  assert.ok(others.length > 0 && others.every((part) => !before.includes(part.name)), "every other box waits until it's used");
  // Most urgent first: the rest of the rules, the box list with its rule to keep the safer reading, and the inner-child
  // safety boxes in the first group; the safety routes and the protective-compatibility file in the second.
  for (const part of [...delivery.rules.slice(delivery.firstNames.length), ...delivery.boxList]) assert.ok(delivery.groups[0].includes(part.name), part.name);
  for (const id of SAFETY_BOX_IDS.filter((entry) => entry.startsWith("IC."))) assert.ok(delivery.groups[0].includes(`${BOX_PART_PREFIX}${id}`), id);
  const early = delivery.groups.slice(0, 2).flat();
  for (const id of SAFETY_BOX_IDS) assert.ok(early.includes(`${BOX_PART_PREFIX}${id}`), id);
  assert.ok(early.includes("references/PROTECTIVE-COMPATIBILITY.md"));
  assert.match(delivery.boxList[0].content, /Where a box and `SKILL\.md` or another reference seem to differ, keep the safer reading/u);
  // The rules say the same for every app, the plugin reading its own files included: the safety boxes' sections before
  // responding, any other box's section before it's used.
  const boxSentence = /`references\/INNER-CHILD-BOX-GUIDANCE\.md` \(one section per box\): read the safety boxes' sections before responding \(([^)]+)\), and any other box's section before you use that box\./u.exec(protocol.instructions);
  assert.ok(boxSentence, "the box sentence");
  assert.deepEqual([...boxSentence[1].matchAll(/`([A-Z]+\.[A-Z0-9_]+)`/gu)].map((match) => match[1]), [...SAFETY_BOX_IDS]);
});

test("the safety boxes are tier 1 of the inner-child map and of the cross-guide routes, and the crisis section's boxes are among them", async () => {
  const tierOne = [];
  for (const graph of ["inner-child-directed-graph", "inner-child-somatic-cross-guide"]) {
    const compiled = JSON.parse(await fs.readFile(path.join(root, `guide-graphs/compiled/${graph}.json`), "utf8"));
    tierOne.push(...compiled.nodes.filter((node) => node.tier === 1).map((node) => node.id));
  }
  assert.deepEqual([...SAFETY_BOX_IDS].sort(), tierOne.sort());
  const titles = new Map(delivery.boxes.map((part) => [part.name, part.content.split("\n")[0]]));
  assert.match(titles.get("box/IC.SUICIDAL_ADULT_SEAT"), /adult or witness seat/u);
  assert.match(titles.get("box/IC.SUICIDAL_SELF_DEATH_INQUIRY"), /self\/death/u);
  assert.match(titles.get("box/IC.PRECIOUS_HUMAN_OPPORTUNITY"), /precious/u);
  assert.match(protocol.instructions, /the boxes on the adult seat, the self\/death inquiry and this precious human life/u);
});

test("a safety box missing from the box file makes the protocol unavailable, even when another safety box is split", () => {
  const ids = SAFETY_BOX_IDS.filter((id) => id !== "IC.PRECIOUS_HUMAN_OPPORTUNITY");
  const content = syntheticBoxFile(ids).replace(`### ${ids[0]}: `, `### ${ids[0]}: `).replace("- Do: ", `- Do: ${"long ".repeat(6000)}\n\n`);
  const broken = syntheticProtocol("Rules.\n", [{ path: BOX_FILE, content }]);
  assert.throws(() => therapyProtocolDelivery(broken), { name: "TherapyProtocolUnavailableError", message: /lacks a safety box: IC\.PRECIOUS_HUMAN_OPPORTUNITY/u });
});

test("a box list too long for one answer comes in pieces, and `boxes` still loads all of them", () => {
  const ids = [...SAFETY_BOX_IDS, ...Array.from({ length: 400 }, (_, index) => `IC.SYNTHETIC_${index}`)];
  const made = syntheticProtocol("Rules.\n", [{ path: BOX_FILE, content: syntheticBoxFile(ids, { titleBytes: 90, bodyBytes: 20 }) }]);
  const built = therapyProtocolDelivery(made);
  assert.ok(built.boxList.length > 1, "the box list is split");
  const loaded = [];
  let pending = [BOX_LIST_PART];
  for (let round = 0; round < 10 && pending.length > 0; round += 1) {
    const answer = therapyProtocolAnswer(made, { parts: pending });
    assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES);
    assert.ok(answer.included.length > 0, "every call brings something");
    loaded.push(...answer.included);
    pending = answer.stillToLoad;
  }
  assert.deepEqual(loaded, built.boxList.map((part) => part.name));
  for (const answer of [therapyProtocolAnswer(made, {}), ...built.groupNames.map((name) => therapyProtocolAnswer(made, { parts: [name] }))]) {
    assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES);
  }
});

test("a name standing for more than 40 parts is answered 40 at a time, and every answer brings at least one part", () => {
  const ids = [...SAFETY_BOX_IDS];
  const huge = `### IC.HUGE: Huge\n\n${Array.from({ length: 1150 }, () => `- Do: ${"d".repeat(1000)}\n\n`).join("")}`;
  const large = `### IC.LARGE: Large\n\n${Array.from({ length: 120 }, () => `- Do: ${"e".repeat(1000)}\n\n`).join("")}`;
  const content = syntheticBoxFile(ids).replace("## Cross-guide routes", `${huge}${large}## Cross-guide routes`);
  const made = syntheticProtocol("Rules.\n", [{ path: BOX_FILE, content }]);
  const built = therapyProtocolDelivery(made);
  const pieces = built.aliases.get("box/IC.HUGE");
  assert.ok(pieces.length > 40, `${pieces.length} pieces`);
  for (const parts of [["box/IC.HUGE"], ["box/IC.HUGE", "box/IC.LARGE"], ["box/IC.LARGE", ...Array(39).fill("box/IC.HUGE")]]) {
    const answer = therapyProtocolAnswer(made, { parts });
    assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES, `${bytes(answer.text)} bytes`);
    assert.ok(answer.included.length > 0, "at least one part");
    assert.ok(answer.text.split("\n").find((line) => line.startsWith("Still to load")).length < 3_000, "the list stays short");
  }
  const first = therapyProtocolAnswer(made, { parts: ["box/IC.HUGE"] });
  assert.match(first.text, /And \d+ more parts after those: ask for them by name once you have loaded these/u);
  // Asking by name for what is still to load brings every piece, each once, in order.
  const loaded = [...first.included];
  let pending = first.stillToLoad;
  for (let round = 0; round < 100 && pending.length > 0; round += 1) {
    const answer = therapyProtocolAnswer(made, { parts: pending.slice(0, 40) });
    assert.ok(answer.included.length > 0 && bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES);
    loaded.push(...answer.included);
    pending = [...answer.stillToLoad.filter((name) => !pending.slice(40).includes(name)), ...pending.slice(40)];
  }
  assert.deepEqual(loaded, pieces);
});

test("the first answer fits with its group list and a changed-protocol note, whatever the rules' sizes", () => {
  for (const sizes of [[26_001, 100], [12_000, 12_000, 12_000], [23_900, 23_900], [3_000]]) {
    const rules = sizes.map((size, index) => `## Section ${index}\n\n${"r".repeat(size)}\n\n`).join("");
    const made = syntheticProtocol(rules);
    const built = therapyProtocolDelivery(made);
    for (const args of [{}, { protocol_sha256: "f".repeat(64) }]) {
      const answer = therapyProtocolAnswer(made, args);
      assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES, `${sizes}: ${bytes(answer.text)} bytes`);
      assert.ok(answer.included.length >= 1);
    }
    assert.equal([...built.firstNames, ...built.groups.flat()].filter((name) => name.startsWith("rules/")).length, built.rules.length, `${sizes}: every rules part is loaded before the first reply`);
  }
});

test("the box list names every box once, and every box the map shows", () => {
  const list = delivery.boxList.map((part) => part.content).join("");
  const listed = [...list.matchAll(/^- `(box\/[^`]+)`: /gmu)].map((match) => match[1]);
  assert.deepEqual(listed, delivery.boxes.map((part) => part.name), "every box, once, in the file's order");
  const box = protocol.files.find((file) => file.path === BOX_FILE);
  for (const [, id] of box.content.matchAll(/^### ([A-Z]+\.[A-Z0-9_]+): /gmu)) assert.ok(listed.includes(`${BOX_PART_PREFIX}${id}`), id);
  const map = protocol.files.find((file) => file.path === "references/INNER-CHILD-THERAPY-MAP.md").content;
  for (const [, id] of map.matchAll(/\["((?:IC|ROUTE)\.[A-Z0-9_]+)<br\/>/gu)) assert.ok(listed.includes(`${BOX_PART_PREFIX}${id}`), id);
  assert.match(list, /Do not mention boxes, their IDs or the map to the person\./u);
  const example = /for example `(box\/[^`]+)`/u.exec(therapyProtocolAnswer(protocol, {}).text)[1];
  assert.ok(delivery.byName.has(example), "the first answer's example box is a real one");
});

test("unknown names are echoed plainly and briefly, so a request naming real parts always gets one", () => {
  const ids = [...SAFETY_BOX_IDS];
  const big = `### IC.BIG: Big\n\n${Array.from({ length: 900 }, () => `- Do: ${"d".repeat(1000)}\n\n`).join("")}`;
  const made = syntheticProtocol("Rules.\n", [{ path: BOX_FILE, content: syntheticBoxFile(ids).replace("## Cross-guide routes", `${big}## Cross-guide routes`) }]);
  const pieces = therapyProtocolDelivery(made).aliases.get("box/IC.BIG");
  const strange = Array.from({ length: 5 }, (_, index) => `${"\u0000".repeat(59)}${index}`);
  const answer = therapyProtocolAnswer(made, { parts: [...pieces.slice(0, 35), ...strange] });
  assert.ok(answer.included.length > 0, "at least one part");
  assert.ok(bytes(answer.text) <= PROTOCOL_ANSWER_MAX_BYTES);
  assert.doesNotMatch(answer.text, /\\u0000/u);
  assert.match(answer.text, /Not part names of this protocol: \["\?{59}0"/u);
});

test("names resolve leniently, unknown ones are reported plainly, and the rest waits for the next call", () => {
  const cases = new Map([
    ["1", [...delivery.groups[0]]],
    ["group 2", [...delivery.groups[1]]],
    ["group/3", [...delivery.groups[2]]],
    ["FOCUS-DISCIPLINE", ["references/FOCUS-DISCIPLINE.md"]],
    ["FOCUS-DISCIPLINE.md", ["references/FOCUS-DISCIPLINE.md"]],
    ["references/focus-discipline.md", ["references/FOCUS-DISCIPLINE.md"]],
    ["./references/GUIDE-REFERRALS.md", ["references/GUIDE-REFERRALS.md"]],
    ["IC.MEET_GUARD", ["box/IC.MEET_GUARD"]],
    ["boxes/IC.MEET_GUARD", ["box/IC.MEET_GUARD"]],
    ["\"rules/2\"", ["rules/2"]],
    ["[box/IC.NEUTRAL_WITNESS]", ["box/IC.NEUTRAL_WITNESS"]],
    ["INNER-CHILD-BOX-GUIDANCE.md", delivery.boxList.map((part) => part.name)],
    [BOX_FILE, delivery.boxList.map((part) => part.name)]
  ]);
  for (const [name, expected] of cases) assert.deepEqual(therapyProtocolAnswer(protocol, { parts: [name] }).included, expected, name);
  // `parts` as one string: a JSON list, or names separated by commas or spaces. A sha256 in capitals is the same sha256.
  assert.deepEqual(therapyProtocolAnswer(protocol, { parts: "rules/2, boxes" }).included, ["rules/2", ...delivery.boxList.map((part) => part.name)]);
  assert.deepEqual(therapyProtocolAnswer(protocol, { parts: "[\"rules/2\"]" }).included, ["rules/2"]);
  assert.deepEqual(therapyProtocolAnswer(protocol, { parts: ["rules/2"], protocol_sha256: protocol.protocolSha256.toUpperCase() }).included, ["rules/2"]);
  // Nothing known: said plainly, with the names to use.
  const none = therapyProtocolAnswer(protocol, { parts: ["no-such-part"] });
  assert.deepEqual([none.included, none.unknown], [[], ["no-such-part"]]);
  assert.match(none.text, /: none of the names you sent is a part of this protocol\.\n/u);
  assert.match(none.text, /Not part names of this protocol: \["no-such-part"\]\. The names are the groups \["group\/1"/u);
  // A request naming too much gets what fits and the names of the rest, never a cut part.
  const everything = therapyProtocolAnswer(protocol, { parts: delivery.all.slice(0, 40).map((part) => part.name) });
  assert.ok(everything.included.length > 0 && everything.stillToLoad.length > 0);
  assert.match(everything.text, /Still to load \(ask for these in another call\): \[/u);
  for (const name of everything.included) assert.equal(blockBody(everything.text, delivery.byName.get(name)), delivery.byName.get(name).content);
});

test("a changed protocol says so and starts again from the first answer", () => {
  const changed = therapyProtocolAnswer(protocol, { parts: ["rules/2"], protocol_sha256: "a".repeat(64) });
  assert.match(changed.text, /The protocol has changed since the answer whose sha256 you sent \(a{64}\)/u);
  assert.ok(changed.text.includes(`InnerSignal therapy protocol ${protocol.version} (sha256 ${protocol.protocolSha256})`));
  assert.deepEqual(changed.included, [...delivery.firstNames]);
  assert.deepEqual(therapyProtocolAnswer(protocol, { parts: ["rules/2"], protocol_sha256: protocol.protocolSha256 }).included, ["rules/2"]);
});

test("with the box advice switched off, no answer names the box file or a box part", () => {
  const off = loadTherapyProtocol({ boxGuidance: false });
  const offDelivery = therapyProtocolDelivery(off);
  assert.deepEqual([offDelivery.boxList, offDelivery.boxes], [[], []]);
  const texts = [therapyProtocolAnswer(off, {}).text, ...offDelivery.groupNames.map((name) => therapyProtocolAnswer(off, { parts: [name] }).text)];
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
  assert.match(instructions, /call load_therapy_protocol and load the parts its first answer lists, as it says/u);
  const answer = (await post("tools/call", { name: "load_therapy_protocol", arguments: { parts: ["group/1"], protocol_sha256: protocol.protocolSha256 } })).result;
  assert.deepEqual(Object.keys(answer).sort(), ["content", "isError"]);
  assert.equal(answer.isError, false);
  for (const name of delivery.groups[0]) assert.equal(blockBody(answer.content[0].text, delivery.byName.get(name)), delivery.byName.get(name).content, name);
  for (const args of [{ parts: 3 }, { parts: [3] }, { parts: Array(41).fill("rules/2") }, { protocol_sha256: "abc" }]) {
    const refused = (await post("tools/call", { name: "load_therapy_protocol", arguments: args })).result;
    assert.equal(refused.isError, true, JSON.stringify(args));
    assert.equal(refused.structuredContent.code, "INVALID_PROTOCOL_REQUEST");
    assert.equal(refused.structuredContent.message, refused.content[0].text.split("\n")[0]);
  }
});
