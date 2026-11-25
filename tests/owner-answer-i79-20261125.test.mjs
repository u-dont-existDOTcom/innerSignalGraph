import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { assessGuideChangeProvenance } from "../scripts/check-guide-change-provenance.mjs";

// The owner's answer to question i79 (25 Nov 2026, about 12:20 UTC): "1a 2a".
// 1a: "Yes: add this line to the forgiveness box, then release it as 0.2.9 once the tests and GPT's review pass (asked again only if
// anything differs)". The line is a Do line of IC.FORGIVENESS_LATER, word for word, right after its line on the other person's conditioning,
// history, pain and capacity; owner amendment AMEND.IC.GENERATIONAL_VIEW_20261125 records his answer, as an approved map line is recorded.
// 2a: "Yes, in the same revision": his newer wording of the forgiveness section, word for word. Guide r12, not merged, appends it to its
// section of 25 Nov live-guide passages, the way r11 and r12 bring in live-guide text, so r11's quotes stay as they were captured on 20 Nov.
// These static tests show where each part is written, served, cited and recorded.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const count = (text, part) => text.split(part).length - 1;

const LINE = `When the person blames a parent and is ready, the owner's guide adds that a parent was also someone's child, so the hurt usually goes back generations ("the web of blame goes back far and wide"), and that some people find it useful to see their own healing as healing what was passed down to them too. Offer this as one way of seeing it, never as a duty or a reason to forgive.`;
const LINE_SHA256 = "bc429538c5883adf403cfcb2f95440d42668ff80c3d59eff9d97922cbd2a91cf";
const AFTER = "When the person is ready, it can help to see how the other person's conditioning, history, pain and capacity shaped the harmful move; they still have to answer for it, and a boundary, the law, distance or keeping away for good can sit beside forgiveness.";
const ANSWER_1A = "Yes: add this line to the forgiveness box, then release it as 0.2.9 once the tests and GPT's review pass (asked again only if anything differs)";
const NODE = "IC.FORGIVENESS_LATER";
const AMENDMENT = "AMEND.IC.GENERATIONAL_VIEW_20261125";
// IC.FORGIVENESS_LATER at 38cc9fa1a (guide r12 before this answer), as a digest of its JSON.
const NODE_BEFORE_SHA256 = "ffbd2ee8618678791735f4bdfbc1a0ab97dec4a3c16e9cea366386cbcaf28f07";
// The served box guidance at 38cc9fa1a, which is main's (9069bee3f).
const BOX_BEFORE_SHA256 = "33b4d27c35290a9492f8a1739c2ef8d7daa79cc015bd72f0b042ee8d4f057a7c";
const BOXES = ["../docs/INNER-CHILD-BOX-GUIDANCE.md", "../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-BOX-GUIDANCE.md"];

const R11_FILE = "inner-child-guide-2026-11-20-r11.txt";
const R11_SHA256 = "6e13a5c9493d2dc6a6bcf971c0fe4dfebe47fb9e610ce4b18cfa62562583656f";
const R12_FILE = "inner-child-guide-2026-11-25-r12.txt";
const R12_VERSION = "owner-decisions-live-guide-passages-2026-11-25-r12";
const SECTION = "IC.LIVE_GUIDE_DECISIONS_20261125";
const HEADING = "Owner Decisions of 25 November 2026: Passages From the Live Guide";
const OLD_FROM = "From “How to Forgive Without Forgetting (376a)”:";
const OLD_PHRASE = "When you see it for yourself";
const NEW_PHRASE = "When you see the causal sequence for yourself";
const INTRO_2A = "In his answer to question i79 on 25 November 2026 (2a, “Yes, in the same revision”), the owner asked for the newer wording of his forgiveness section to come in too, word for word. In the same live post, fetched again that day at 12:31 UTC and still as updated 2026-11-24T22:39:08Z, the section quoted above under “How to Forgive Without Forgetting (376a)” is now headed “Forgiving, Not Forgetting”, and its paragraph that says “When you see it for yourself” now says “When you see the causal sequence for yourself”. That paragraph follows as it now reads; the section's other four paragraphs, and its subheading “Forgiving Yourself”, read as quoted above.";
const FROM_2A = "From “Forgiving, Not Forgetting (i79 2a)”:";
// The paragraph as the live post has it (fetched again through the Substack API on 25 Nov 2026 at 12:31 UTC: updated_at 2026-11-24T22:39:08.694Z,
// the same bytes as the morning's capture, sha256 8fd65138…8b95). There "secret burning thread" is a link and "they must have no clue" is
// italic; guide text carries neither, as in r11.
const PARAGRAPH_2A = "“Hurt people hurt people, healed people heal people” means that hurt people pass on pain they never worked through, although “externalizers” are the ones who directly hurt others, while “internalizers” try to protect others by holding that “secret burning thread” inside themself, which ends up exploding onto others anyway at times when it gets to be too much to hold. You may have heard this story from somebody telling you to forgive, and it sounded like they must have no clue how deep the betrayal was. When you see the causal sequence for yourself, though, you might find yourself forgiving them, and if you’ve held them uniquely to blame, the rage can soften into something more accurate.";
const CAPTURE_SHA256 = "8fd65138eef4332f579c31c610eea7404f5a96fd6ce7bdb1813428192f3a8b95";

const r11 = read(`../guides/${R11_FILE}`);
const r12 = read(`../guides/${R12_FILE}`);
const lines = r12.split("\n");
const candidate = json("../guide-graphs/candidates/inner-child.graph.json").nodes.find((entry) => entry.id === NODE);

test("1a: the owner's line is a Do line of the forgiveness node, word for word, right after the conditioning line, with his answer as its amendment", () => {
  assert.equal(sha256(LINE), LINE_SHA256, "the line as he gave it");
  assert.equal(candidate.recommendations.indexOf(LINE), candidate.recommendations.indexOf(AFTER) + 1, "right after the conditioning line");
  assert.equal(candidate.recommendations.at(-1), LINE);
  assert.equal(candidate.recommendations.filter((line) => line === LINE).length, 1);
  assert.equal(candidate.sourceRefs.at(-1), AMENDMENT);
  const before = { ...candidate, sourceRefs: candidate.sourceRefs.filter((ref) => ref !== AMENDMENT), recommendations: candidate.recommendations.filter((line) => line !== LINE) };
  assert.equal(sha256(JSON.stringify(before)), NODE_BEFORE_SHA256, "nothing else about the node changes: no other line, gate or effect");

  const amendments = json("../guides/owner-amendments.json");
  assert.equal(amendments.version, "owner-amendments-2026-11-25-r25");
  assert.equal(amendments.approvedAt, "2026-11-25");
  assert.equal(json("../guides/manifest.json").sources.find((source) => source.id === "owner-amendments").version, amendments.version);
  const item = amendments.items.at(-1);
  assert.deepEqual(Object.keys(item), ["id", "domain", "status", "approvedAt", "text"]);
  assert.deepEqual([item.id, item.domain, item.status, item.approvedAt], [AMENDMENT, "inner-child", "owner-approved", "2026-11-25"]);
  assert.ok(item.text.startsWith(`Owner answer i79 1a (25 Nov 2026, about 12:20 UTC): "${ANSWER_1A}".`));
  assert.equal(count(item.text, LINE), 1, "the line, word for word");
  assert.ok(item.text.includes(SECTION), "and the passage it comes from");
  assert.equal(amendments.items.filter((entry) => entry.id === AMENDMENT).length, 1);

  const files = fs.readdirSync(new URL("../guide-graphs/candidates/", import.meta.url)).filter((file) => file.endsWith(".graph.json"));
  const holders = files.flatMap((file) => json(`../guide-graphs/candidates/${file}`).nodes.filter((node) => JSON.stringify(node).includes("web of blame")).map((node) => node.id));
  assert.deepEqual(holders, [NODE], "no other node holds it");
});

test("1a: chats are served the line once, in the forgiveness box, and the box guidance changes by that line alone", async () => {
  const [docs, served] = BOXES.map(read);
  assert.equal(served, docs, "the served copy is the generated view");
  const boxLines = served.split("\n");
  const at = boxLines.indexOf(`- Do: ${LINE}`);
  assert.ok(at > 0);
  assert.equal(count(served, LINE), 1);
  assert.equal(boxLines[at - 1], `- Do: ${AFTER}`);
  assert.ok(boxLines.slice(0, at).filter((line) => line.startsWith("### ")).at(-1).startsWith(`### ${NODE}: `), "in the forgiveness box");
  assert.equal(sha256(served.replace(`- Do: ${LINE}\n`, "")), BOX_BEFORE_SHA256, "without the line the box guidance is byte for byte what it was");

  const protocol = loadTherapyProtocol();
  assert.equal(protocol.files.find((file) => file.path === "references/INNER-CHILD-BOX-GUIDANCE.md").content, served);
  assert.equal(count([protocol.instructions, ...protocol.files.map((file) => file.content)].join("\n"), LINE), 1, "served once");

  const bundle = await compileGuideGraphs({ write: false });
  assert.deepEqual(bundle.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === NODE).recommendations, candidate.recommendations);
  assert.deepEqual(json("../guide-graphs/compiled/bundle.json").graphs.flatMap((graph) => graph.nodes).find((node) => node.id === NODE).recommendations, candidate.recommendations, "the committed bundle is compiled");
  // A person who wants to talk about forgiveness (graph case G152) gets the box with the line among its advice.
  const { variables, unknowns } = json("../corpus/graph-cases/G152.json");
  assert.equal(variables.forgiveness_interest, "present");
  const plan = planFromGraphs({ graphs: bundle.graphs, variables, unknowns: unknowns ?? [] });
  assert.deepEqual(plan.selectedNodes.find((node) => node.id === NODE)?.recommendations.slice(-2), [AFTER, LINE]);
});

test("2a: r12 quotes the forgiveness section's new heading and changed paragraph word for word, after the Generational Trauma passage", () => {
  assert.equal(sha256(r11), R11_SHA256, "r11 is untouched");
  assert.ok(r12.startsWith(r11), "and still the first part of r12, so its 20 Nov quotes stay as captured");
  const r11Lines = r11.split("\n");
  const oldParagraph = r11Lines.find((line, index) => index > r11Lines.indexOf(OLD_FROM) && line.includes(OLD_PHRASE));
  assert.equal(count(oldParagraph, OLD_PHRASE), 1);
  assert.equal(oldParagraph.replace(OLD_PHRASE, NEW_PHRASE), PARAGRAPH_2A, "the live paragraph differs from r11's quote by the phrase alone");
  assert.equal(count(r12, PARAGRAPH_2A), 1);
  assert.equal(count(r12, FROM_2A), 1);
  assert.deepEqual([HEADING, INTRO_2A, FROM_2A, PARAGRAPH_2A].map((text) => lines.indexOf(text) + 1), [1227, 1237, 1239, 1241]);
  assert.deepEqual([lines[1235], lines[1237], lines[1239], lines[1241], lines.length], ["", "", "", "", 1242], "each apart, then the final newline");
  for (const part of ["question i79 on 25 November 2026 (2a, “Yes, in the same revision”)", "word for word", "fetched again that day at 12:31 UTC and still as updated 2026-11-24T22:39:08Z",
    "the section quoted above under “How to Forgive Without Forgetting (376a)” is now headed “Forgiving, Not Forgetting”", `“${OLD_PHRASE}” now says “${NEW_PHRASE}”`,
    "the section's other four paragraphs, and its subheading “Forgiving Yourself”, read as quoted above"]) {
    assert.ok(INTRO_2A.includes(part), part);
  }
  assert.equal(count(r12, "Owner Decision of 25 November 2026"), 0, "the section heading names both passages");

  const manifest = json("../guides/manifest.json");
  assert.deepEqual(manifest.sources.find((source) => source.id === "inner-child-guide"), { id: "inner-child-guide", version: R12_VERSION, file: R12_FILE, sha256: sha256(r12), role: "primary-framework", format: "text" });
  assert.match(manifest.notes, /and, at his answer i79 2a of the same day, that section's newer wording from the same post: its heading is now 'Forgiving, Not Forgetting', and one paragraph now says 'When you see the causal sequence for yourself' where r11 quotes 'When you see it for yourself'; IC\.FORGIVENESS_LATER cites them\. Owner amendments r25 add his answer i79 1a, one line served in the forgiveness box\.$/u);
  const layout = json("../guides/source-layout.json");
  assert.equal(layout.version, "source-layout-v18-2026-11-25");
  assert.deepEqual(layout.textGuides.find((guide) => guide.guideId === "inner-child-guide").sections.at(-1), { id: SECTION, heading: HEADING });
  const sourceMap = json("../guide-graphs/source-maps/inner-child-guide.json");
  const section = sourceMap.sections.find((entry) => entry.id === SECTION);
  assert.deepEqual([section.heading, section.lineStart, section.lineEnd], [HEADING, 1227, 1242]);
  const text = lines.slice(section.lineStart - 1, section.lineEnd).join("\n");
  assert.ok(text.includes(`${FROM_2A}\n\n${PARAGRAPH_2A}\n`));
  assert.equal(sha256(text.trim()), section.sha256);
  assert.ok(candidate.sourceRefs.includes(SECTION), "the forgiveness node cites the section");
  for (const id of ["IC.FORGIVENESS", "IC.LIVE_GUIDE_DECISIONS_20261120"]) {
    const before = { "IC.FORGIVENESS": [917, 966], "IC.LIVE_GUIDE_DECISIONS_20261120": [1047, 1226] }[id];
    const entry = sourceMap.sections.find((candidateSection) => candidateSection.id === id);
    assert.deepEqual([entry.lineStart, entry.lineEnd], before, `${id} keeps its lines`);
  }
  // Nothing of 2a is served: the guide text reaches the node's citations, not the text chats are given.
  const protocol = loadTherapyProtocol();
  const served = [protocol.instructions, ...protocol.files.map((file) => file.content)].join("\n");
  for (const part of [NEW_PHRASE, "Forgiving, Not Forgetting", "Hurt people hurt people"]) assert.equal(served.includes(part), false, part);
});

test("PGQ-091 and PGQ-092 and the sync record name both parts of the answer, and pass the provenance rules continuous integration applies", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  const bundleStart = queue.indexOf("## Pending: the owner's answer to question i79 of 25 November 2026 (PGQ-091 and PGQ-092)");
  assert.ok(bundleStart > queue.indexOf("### PGQ-090 — ") && bundleStart < queue.indexOf("## EMPTY sentinel"), "after PGQ-090");
  const body = (id) => queue.slice(queue.indexOf(`### ${id} — `)).split("\n## ")[0].split("\n### ")[0];
  assert.match(body("PGQ-091"), /^### PGQ-091 — The generational view is one way of seeing it, never a duty or a reason to forgive$/mu);
  assert.match(body("PGQ-091"), /^Caused by: Owner answer i79 1a \(25 Nov 2026, about 12:20 UTC\): owner amendment AMEND\.IC\.GENERATIONAL_VIEW_20261125 \(r25\), served word for word as a Do line of `IC\.FORGIVENESS_LATER`/mu);
  assert.match(body("PGQ-091"), /^Already covered: Partly: /mu);
  assert.match(body("PGQ-092"), /^### PGQ-092 — Forgiving, not forgetting: when you see the causal sequence for yourself$/mu);
  assert.match(body("PGQ-092"), /^Caused by: Guide r12 \(`guides\/inner-child-guide-2026-11-25-r12\.txt` lines 1239–1241\) quotes word for word the newer wording of the live guide's forgiveness section/mu);
  assert.match(body("PGQ-092"), /^Already covered: The live guide carries it in his own words under “Forgiving, Not Forgetting” \(as updated 2026-11-24T22:39:08Z\); r12 quotes it from there\.$/mu);
  assert.deepEqual([lines[1238], lines[1240]], [FROM_2A, PARAGRAPH_2A], "PGQ-092's lines");

  const record = json("../authoring/public-guide-sync.json").guides.find((guide) => guide.id === "inner-child").ownerDecision20261125;
  assert.equal(record.ownerAnswerI79.words, "1a 2a");
  assert.ok(record.ownerAnswerI79.options["1a"].endsWith(`the line, exactly: ${LINE}`));
  assert.equal(record.liveGuide.updatedAt, "2026-11-24T22:39:08.694Z");
  assert.equal(record.liveGuide.refetchedFileSha256, CAPTURE_SHA256);
  assert.deepEqual(record.amendments, { path: "guides/owner-amendments.json", version: "owner-amendments-2026-11-25-r25", notes: record.amendments.notes });
  assert.deepEqual(record.obligations.slice(1).map((entry) => [entry.id, entry.liveHeading, entry.r12Lines, entry.decisions, entry.amendments, entry.queue]), [
    ["PGQ-091", null, null, ["i79 1a"], [AMENDMENT], "PENDING"],
    ["PGQ-092", "Forgiving, Not Forgetting", [1239, 1241], ["i79 2a"], [], "PENDING"]
  ]);

  // Against the queue without the i79 bundle, the answer's change passes the rules continuous integration applies, and without it is refused.
  const before = queue.slice(0, bundleStart) + queue.slice(queue.indexOf("## EMPTY sentinel"));
  const changedPaths = [`guides/${R12_FILE}`, "guides/manifest.json", "guides/owner-amendments.json", "guides/source-layout.json", "guide-graphs/candidates/inner-child.graph.json",
    "plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-BOX-GUIDANCE.md", "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md", "authoring/public-guide-sync.json"];
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: queue }), []);
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: before }), ["Teaching-point queue did not change in content.", "Queue-only rewrite without added, revised or consumed obligations is insufficient."]);
});
