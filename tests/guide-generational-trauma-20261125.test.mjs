import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { assessGuideChangeProvenance } from "../scripts/check-guide-change-provenance.mjs";

// The owner's message of 25 Nov 2026 (chat, about 01:20 UTC): the new "Generational Trauma" section of his live guide "may go into
// innersignal also (subheading under forgiving, not forgetting)". As guide r11 did for his answers of 20 Nov, guide r12 is r11 unchanged
// plus one appended section quoting the passage word for word from the live post (as updated 2026-11-24T22:39:08Z, where it is an h4 under
// "Forgiving, Not Forgetting"), and the forgiveness node cites that section. His message names only where it goes, so no owner amendment,
// node line or served rule is added. These static tests show where the passage is written, cited and recorded.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const count = (text, part) => text.split(part).length - 1;

const R11_FILE = "inner-child-guide-2026-11-20-r11.txt";
const R11_SHA256 = "6e13a5c9493d2dc6a6bcf971c0fe4dfebe47fb9e610ce4b18cfa62562583656f";
const R11_VERSION = "owner-decisions-live-guide-passages-2026-11-20-r11";
const R12_FILE = "inner-child-guide-2026-11-25-r12.txt";
const R12_VERSION = "owner-decision-live-guide-generational-trauma-2026-11-25-r12";
const SECTION = "IC.LIVE_GUIDE_DECISIONS_20261125";
const HEADING = "Owner Decision of 25 November 2026: A Passage From the Live Guide";
const FROM = "From “Generational Trauma (25 Nov: subheading under forgiving, not forgetting)”:";
// Both paragraphs as the live post has them, typographic apostrophes included; there "Beloved" is an italic link, and guide text carries neither.
const PASSAGE = [
  "Even if your papa really was your papa, and not a crocodile pretending to be, your papa was also the son of his papa and mama. It might seem sensible to blame your parents for their shortcomings, but the web of blame goes back far and wide. It reminds me of the book, Beloved, by Toni Morrison, that shows how the trauma from slavery continues for many generations after it’s over.",
  "Many people today are saying that they are not only trying to heal their own trauma, but in so doing, the trauma of their ancestors. I think that’s a useful way to look at it, because the truth is that there’s nothing which is only yours. Everything gets passed on. And whatever we do to heal ourselves also heals the whole world now and in the future."
];
const NODE = "IC.FORGIVENESS_LATER";
// IC.FORGIVENESS_LATER on main (9069bee3f) before this change, as a digest of its JSON.
const NODE_ON_MAIN_SHA256 = "0baddc4c7d290bcb2ead5f9c2ab85325e25e14a9d5aac44259cd7fd2cf41ba34";

const manifest = json("../guides/manifest.json");
const active = manifest.sources.find((source) => source.id === "inner-child-guide");
const r11 = read(`../guides/${R11_FILE}`);
const r12 = read(`../guides/${R12_FILE}`);
const lines = r12.split("\n");

test("guide r12 is r11 byte for byte plus one appended section, and is the active revision", () => {
  assert.equal(sha256(r11), R11_SHA256, "r11 is untouched");
  assert.deepEqual(active, { id: "inner-child-guide", version: R12_VERSION, file: R12_FILE, sha256: sha256(r12), role: "primary-framework", format: "text" });
  assert.equal(manifest.sourceHistory.filter((entry) => entry.file === R11_FILE && entry.sha256 === R11_SHA256 && entry.version === R11_VERSION).length, 1, "r11 moves into the history");
  assert.equal(manifest.sourceHistory.some((entry) => entry.file === R12_FILE), false);
  assert.match(manifest.notes, /November 25 r12 preserves immutable November 20 r11 and appends, word for word, the live guide's 'Generational Trauma'/u);
  assert.ok(r12.startsWith(r11), "r11 is the first part of r12");
  // The appended part: a blank line, the heading, the provenance paragraph, the From line and the two paragraphs, each apart, then the final newline.
  const appended = r12.slice(r11.length).split("\n");
  assert.deepEqual([appended[1], appended[5], appended[7], appended[9]], [HEADING, FROM, PASSAGE[0], PASSAGE[1]]);
  assert.deepEqual([0, 2, 4, 6, 8, 10].map((index) => appended[index]), ["", "", "", "", "", ""]);
  assert.equal(appended.length, 11);
  const intro = appended[3];
  for (const part of ["quoted word for word from the owner's live public guide", "the Substack post as updated 2026-11-24T22:39:08Z", "“Generational Trauma” is a subheading of “Forgiving, Not Forgetting”",
    "the forgiveness section quoted above as “How to Forgive Without Forgetting”", "just before “Forgiving Yourself”", "On 25 November 2026", "“subheading under forgiving, not forgetting”", "the video that follows them in his guide is not brought in"]) {
    assert.ok(intro.includes(part), part);
  }
});

test("the passage is in r12 word for word, once, under its From line, in the section the source map gives", () => {
  for (const paragraph of PASSAGE) {
    assert.equal(count(r12, paragraph), 1, paragraph.slice(0, 40));
    assert.equal(r11.includes(paragraph), false, "new to r11");
    assert.deepEqual([...new Set(paragraph.match(/[^\x20-\x7e]/gu))], ["’"], "only typographic apostrophes beyond plain ASCII");
    assert.doesNotMatch(paragraph, /[<>*_[\]]|https?:/u, "no markup or link");
  }
  assert.deepEqual([lines.indexOf(HEADING), lines.indexOf(FROM), ...PASSAGE.map((paragraph) => lines.indexOf(paragraph))].map((index) => index + 1), [1227, 1231, 1233, 1235]);

  const layout = json("../guides/source-layout.json");
  const guide = layout.textGuides.find((entry) => entry.guideId === "inner-child-guide");
  assert.equal(layout.version, "source-layout-v18-2026-11-25");
  assert.equal(guide.file, R12_FILE);
  assert.deepEqual(guide.sections.slice(-2), [
    { id: "IC.LIVE_GUIDE_DECISIONS_20261120", heading: "Owner Decisions of 20 November 2026: Passages From the Live Guide" },
    { id: SECTION, heading: HEADING }
  ]);
  assert.equal(guide.sections.filter((section) => section.heading === HEADING).length, 1);
  assert.equal(count(r12, `\n${HEADING}\n`), 1, "the heading is unique, so the section starts there");

  const sourceMap = json("../guide-graphs/source-maps/inner-child-guide.json");
  assert.equal(sourceMap.file, R12_FILE);
  const section = sourceMap.sections.find((entry) => entry.id === SECTION);
  assert.deepEqual([section.lineStart, section.lineEnd], [1227, 1236]);
  const text = lines.slice(section.lineStart - 1, section.lineEnd).join("\n");
  for (const part of [FROM, ...PASSAGE]) assert.ok(text.includes(part), part.slice(0, 40));
  assert.equal(sha256(text.trim()), section.sha256);
  // r11's section keeps its lines and its hash: appending after it changes neither.
  const r11Section = sourceMap.sections.find((entry) => entry.id === "IC.LIVE_GUIDE_DECISIONS_20261120");
  assert.deepEqual([r11Section.lineStart, r11Section.lineEnd, r11Section.sha256], [1047, 1226, "4c2f8355b4d7b914c115e637559e3dde1a76ff26f7408737a4d909462d47dd35"]);
  const forgiveness = sourceMap.sections.find((entry) => entry.id === "IC.FORGIVENESS");
  assert.deepEqual([forgiveness.lineStart, forgiveness.lineEnd], [917, 966], "the canonical forgiveness section is unchanged");
});

test("the forgiveness node cites the section, and nothing else about the node changes", async () => {
  const graphFiles = fs.readdirSync(new URL("../guide-graphs/candidates/", import.meta.url)).filter((file) => file.endsWith(".graph.json"));
  const citers = graphFiles.flatMap((file) => json(`../guide-graphs/candidates/${file}`).nodes.filter((candidate) => (candidate.sourceRefs ?? []).includes(SECTION)).map((candidate) => candidate.id));
  assert.deepEqual(citers, [NODE], "only the forgiveness node cites it");
  const node = json("../guide-graphs/candidates/inner-child.graph.json").nodes.find((candidate) => candidate.id === NODE);
  assert.deepEqual(node.sourceRefs.slice(-2), ["IC.LIVE_GUIDE_DECISIONS_20261120", SECTION]);
  assert.ok(node.sourceRefs.includes("IC.FORGIVENESS"));
  assert.equal(sha256(JSON.stringify({ ...node, sourceRefs: node.sourceRefs.filter((ref) => ref !== SECTION) })), NODE_ON_MAIN_SHA256, "without the reference, the node is main's: no line, gate or effect added");

  const bundle = await compileGuideGraphs({ write: false });
  assert.ok(bundle.graphs.flatMap((graph) => graph.nodes).find((candidate) => candidate.id === NODE).sourceRefs.includes(SECTION));
  assert.deepEqual(json("../guide-graphs/compiled/bundle.json").sourceMaps, JSON.parse(JSON.stringify(bundle.sourceMaps)), "the committed bundle is compiled from r12");
  const note = read(`../authoring/obsidian/current/sources/inner-child-guide/${SECTION}.md`);
  assert.match(note, /^cited_by_node_ids:\n {2}- IC\.FORGIVENESS_LATER\n/mu);
  assert.ok(note.includes(`Authority path: \`guides/${R12_FILE}\``));
  assert.ok(read(`../authoring/obsidian/current/nodes/inner-child-directed-graph/${NODE}.md`).includes(`[[current/sources/inner-child-guide/${SECTION}]]`));

  // No owner amendment, and no served rule: the passage reaches the guide and the node's citations, not the text chats are given.
  const amendments = json("../guides/owner-amendments.json");
  assert.equal(amendments.version, "owner-amendments-2026-11-21-r24");
  assert.equal(amendments.items.length, 96);
  assert.equal(amendments.items.some((item) => /generational|web of blame|Toni Morrison/iu.test(item.text)), false);
  const protocol = loadTherapyProtocol();
  const served = [protocol.instructions, ...protocol.files.map((file) => file.content)].join("\n");
  for (const part of [...PASSAGE, "Generational Trauma", "web of blame", "crocodile", "Toni Morrison", SECTION]) assert.equal(served.includes(part), false, part.slice(0, 40));
});

test("the queue entry and the sync record name r12's lines and the live post, and pass the provenance rules continuous integration applies", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^Status: \*\*PENDING\*\*$/mu);
  const body = queue.slice(queue.indexOf("### PGQ-090 — ")).split("\n## ")[0];
  assert.match(body, /^### PGQ-090 — Generational trauma: the web of blame goes back far and wide$/mu);
  assert.match(body, /^Caused by: Guide r12 \(`guides\/inner-child-guide-2026-11-25-r12\.txt` lines 1231–1235\) quotes this word for word from the owner's live guide \(Substack post as updated 2026-11-24T22:39:08Z\)/mu);
  assert.match(body, /\("subheading under forgiving, not forgetting"\)\. No owner amendment; `IC\.FORGIVENESS_LATER` cites it\./u);
  assert.match(body, /^Already covered: The live guide carries it in his own words under “Generational Trauma”, a subheading of “Forgiving, Not Forgetting”/mu);

  const record = json("../authoring/public-guide-sync.json").guides.find((guide) => guide.id === "inner-child").ownerDecision20261125;
  assert.equal(record.liveGuide.url, "https://ibogaqueen.substack.com/p/inner-child-self-love-tips-and-guided");
  assert.equal(record.liveGuide.updatedAt, "2026-11-24T22:39:08.694Z");
  assert.equal(record.liveGuide.bodyHtmlSha256, "5bc1434b646566975892760e053ea81407077f3b01f8b4bed04f258a1aeb0a79");
  assert.equal(record.ownerRequest.words, "so that may go into innersignal also (subheading under forgiving, not forgetting)");
  assert.deepEqual(record.canonical, { path: `guides/${R12_FILE}`, version: R12_VERSION, sha256: sha256(r12), section: HEADING, lines: [1227, 1235] });
  assert.deepEqual(record.graph, { node: NODE, sourceRef: SECTION });
  assert.deepEqual(record.obligations.map((entry) => [entry.id, entry.r12Lines, entry.queue]), [["PGQ-090", [1231, 1235], "PENDING"]]);
  assert.equal(lines[record.obligations[0].r12Lines[0] - 1], FROM);
  assert.equal(lines[record.obligations[0].r12Lines[1] - 1], PASSAGE[1]);

  // Against the queue as it stood before (r24, without this bundle), the change passes the rules continuous integration applies.
  const start = queue.indexOf("## Pending: the owner's decision of 25 November 2026 (PGQ-090)");
  const before = (queue.slice(0, start) + queue.slice(queue.indexOf("## EMPTY sentinel"))).replace("Queue version: 2026-11-25-r25", "Queue version: 2026-11-21-r24");
  const changedPaths = [`guides/${R12_FILE}`, "guides/manifest.json", "guides/source-layout.json", "guide-graphs/candidates/inner-child.graph.json", "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md", "authoring/public-guide-sync.json"];
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: queue }), []);
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: before }), ["Teaching-point queue did not change in content.", "Queue-only rewrite without added, revised or consumed obligations is insufficient."], "without the entry the guide edit is refused");
});
