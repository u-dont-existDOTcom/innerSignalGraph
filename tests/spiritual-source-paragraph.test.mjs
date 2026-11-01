import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { withoutIssue215, QUESTION_51_R9_SHA256, CURRENT_R9_SHA256 } from "./fixtures/issue-215-guide-edits.mjs";

// Owner answer 52a (owner question 52, 31 October 2026, 23:29 UTC): "that's for the AI guide, humanized guide still want to review in its
// own lane". The AI guide gets one new paragraph in "Ask God for a Loan" as a new revision, r10; the map gets one line on an existing node,
// IC.BORROW_LOVE, which already cites that section; the humanized guide gets a queue entry only (PGQ-055), never a text. These static tests
// show where the paragraph and the line are written, bound, compiled, planned and recorded; they do not show that a model follows the line.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// The paragraph exactly as the owner's question 52 gave it, with the typographic apostrophes the rest of the guide uses.
const PARAGRAPH = "There may be a deeper spiritual level of perfection, wisdom, and compassion that we can open to. Contact with it can bring release, love, and reassurance in its own right, and it can help you consciously build your own Nurturer, Protector, and Guide. But I don’t treat it as a source of specific facts about ordinary life, and it doesn’t replace discernment: an impression that seems to come through it still gets tested like any other. That is different from the claim, which I reject below, that a perfect Higher Self is already waiting underneath everything.";
// The one map line, appended last to IC.BORROW_LOVE.
const NODE_LINE = "When a person reports contact with a deeper spiritual level of perfection, wisdom or compassion, it may bring release, love and reassurance in its own right and can help build the inner Nurturer, Protector and Guide; do not treat it as a source of specific facts about ordinary life or let it replace discernment, so an impression that seems to come through it is tested like any other, and neither affirm nor deny what it is.";

const FEAST = "This is the feast problem. You can have an enormous spiritual feast upstairs while the child is still starving downstairs. Spiritual integration means some of what you have actually reaches them.";
const NEXT_HEADING = "When the Spiritual Relationship Hurts";
const SECTION = "IC.SPIRITUAL_LOAN";
const NODE = "IC.BORROW_LOVE";
const R9_FILE = "inner-child-guide-2026-10-31-r9.txt";
const R10_FILE = "inner-child-guide-2026-10-31-r10.txt";
const R10_SHA256 = "0ad32952057b1fbf4c8407bef8035475c9629ad4be7545adee76652ba7774ab2";
const R10_VERSION = "owner-approved-spiritual-source-paragraph-2026-10-31-r10";
const R9_VERSION = "owner-approved-conflict-appraisal-addition-2026-10-31-r9";
// IC.BORROW_LOVE exactly as it stood before this change (nine recommendations), as a digest of its JSON.
const BORROW_LOVE_BEFORE_SHA256 = "7fb68c7cf4e75619389136bbb3afdd5ff217c3b8a03abfda72a9e0faa113f744";
// Every other node and every edge of the four candidate graphs (cross-guide, inner-child, inner-signal-hypnosis, somatic), as one digest, as they stood on main before this change.
const OTHER_NODES_AND_EDGES_SHA256 = "767a5bd8bbb92c1592828d48c666bd2bb614e38b8f29e8c46fd33a5fd6d0f8d3";

const manifest = json("../guides/manifest.json");
const active = manifest.sources.find((source) => source.id === "inner-child-guide");
const sourceMap = json("../guide-graphs/source-maps/inner-child-guide.json");
const candidateGraph = json("../guide-graphs/candidates/inner-child.graph.json");
const node = (graph, id) => graph.nodes.find((candidate) => candidate.id === id);

test("AI guide r10 is r9 plus exactly one paragraph, and r9 stays immutable", () => {
  const r9 = read(`../guides/${R9_FILE}`);
  const r10 = read(`../guides/${R10_FILE}`);
  assert.equal(sha256(r9), CURRENT_R9_SHA256, "r9 is untouched");
  assert.equal(sha256(r10), R10_SHA256);
  assert.equal(PARAGRAPH.length, 561);
  assert.equal(count(r9, PARAGRAPH), 0, "the paragraph is new to r9");
  assert.equal(count(r10, PARAGRAPH), 1, "and it is in r10 once");

  // Taking the paragraph (and the one blank line that keeps it apart) out gives r9 back byte for byte; putting it in gives r10.
  assert.equal(r10.replace(`${PARAGRAPH}\n\n`, ""), r9);
  assert.equal(r10, r9.replace(`${FEAST}\n\n${NEXT_HEADING}\n`, () => `${FEAST}\n\n${PARAGRAPH}\n\n${NEXT_HEADING}\n`));
  assert.equal(r10.length - r9.length, PARAGRAPH.length + 2);

  // Line by line: two lines come in (the paragraph and a blank line) and none of r9's changes or moves except by those two.
  const before = r9.split("\n");
  const after = r10.split("\n");
  assert.equal(after.length - before.length, 2);
  assert.equal(before[290], FEAST, "r9 line 291 is the feast problem");
  assert.equal(before[292], NEXT_HEADING, "r9 line 293 is the next heading");
  assert.deepEqual(after.slice(0, 292), before.slice(0, 292), "everything up to the blank line after the feast problem is as it was");
  assert.equal(after[292], PARAGRAPH, "r10 line 293 is the paragraph");
  assert.equal(after[293], "");
  assert.equal(after[294], NEXT_HEADING, "and the next heading follows it");
  assert.deepEqual(after.slice(294), before.slice(292), "everything after is as it was, two lines lower");

  // The guide's typography: typographic apostrophes (exactly the two in "don’t" and "doesn’t"), no straight ones, one line.
  assert.equal(count(PARAGRAPH, "’"), 2);
  assert.equal(PARAGRAPH.includes("'"), false);
  assert.equal(PARAGRAPH.includes("\n"), false);
  assert.match(PARAGRAPH, /But I don’t treat it as a source of specific facts about ordinary life, and it doesn’t replace discernment: an impression that seems to come through it still gets tested like any other\./u);
  assert.match(PARAGRAPH, /That is different from the claim, which I reject below, that a perfect Higher Self is already waiting underneath everything\.$/u);

  // The chain back is intact: r10 -> r9 -> the question 51 form of r9 (the other checks of that chain are in guide-source-sync).
  assert.equal(sha256(withoutIssue215(r9)), QUESTION_51_R9_SHA256);
});

test("the paragraph sits in Ask God for a Loan, right after the feast problem, and every later section moves down two lines", () => {
  const r9Lines = read(`../guides/${R9_FILE}`).split("\n");
  const r10Lines = read(`../guides/${R10_FILE}`).split("\n");
  const layout = json("../guides/source-layout.json");
  const headings = new Map(layout.textGuides.find((guide) => guide.guideId === "inner-child-guide").sections.map((section) => [section.id, section.heading]));
  assert.equal(sourceMap.file, R10_FILE);
  assert.equal(sourceMap.sections.length, 38, "no section is added or removed");

  const loan = sourceMap.sections.find((section) => section.id === SECTION);
  assert.deepEqual([loan.lineStart, loan.lineEnd], [281, 294], "two lines longer than in r9 (281 to 292)");
  assert.equal(r10Lines[loan.lineStart - 1], "Ask God for a Loan");
  const paragraphLine = r10Lines.indexOf(PARAGRAPH) + 1;
  assert.equal(paragraphLine, 293);
  assert.ok(loan.lineStart < paragraphLine && paragraphLine <= loan.lineEnd, "the paragraph is inside the section");
  assert.equal(r10Lines[paragraphLine - 3], FEAST, "directly after the paragraph that begins \"This is the feast problem.\"");
  assert.equal(r10Lines[paragraphLine + 1], NEXT_HEADING, "and before the heading \"When the Spiritual Relationship Hurts\"");
  const struggle = sourceMap.sections.find((section) => section.id === "IC.SPIRITUAL_STRUGGLE");
  assert.deepEqual([struggle.lineStart, struggle.lineEnd], [295, 300]);
  assert.equal(r10Lines[struggle.lineStart - 1], NEXT_HEADING);

  // Every section starts at its own heading in r10; sections up to this one are where they were; the later ones start exactly two lines lower.
  let reachedLoan = false;
  for (const section of sourceMap.sections) {
    assert.equal(r10Lines[section.lineStart - 1], headings.get(section.id), `${section.id} starts at its heading`);
    if (section.id === SECTION) reachedLoan = true;
    const moved = reachedLoan && section.id !== SECTION ? 2 : 0;
    assert.equal(r9Lines[section.lineStart - 1 - moved], headings.get(section.id), `${section.id} was ${moved} lines higher in r9`);
  }
  // The source map's convention: the last section ends at the count of the file split on newlines (the empty element after the final newline counts).
  assert.equal(sourceMap.sections.at(-1).lineEnd, r10Lines.length);
  assert.equal(r10Lines.length, r9Lines.length + 2);
  const related = sourceMap.sections.find((section) => section.id === "IC.RELATED_CLINICAL_WORK");
  assert.deepEqual([related.lineStart, related.lineEnd], [1029, 1046]);
  // The section's hash is the hash of its trimmed text (the source-map script's rule), so the source map follows the paragraph.
  assert.equal(sha256(r10Lines.slice(loan.lineStart - 1, loan.lineEnd).join("\n").trim()), loan.sha256);
});

test("everything that names the active revision names r10 and its hash, and r9 moves into the history", () => {
  assert.equal(active.version, R10_VERSION);
  assert.equal(active.file, R10_FILE);
  assert.equal(active.sha256, R10_SHA256);
  assert.equal(sha256(read(`../guides/${R10_FILE}`)), active.sha256);
  const history = manifest.sourceHistory.filter((item) => item.id === "inner-child-guide");
  assert.equal(history.length, 17, "every earlier revision is kept, and r9 is the newest of them");
  assert.deepEqual(history.at(-1), { id: "inner-child-guide", version: R9_VERSION, file: R9_FILE, sha256: CURRENT_R9_SHA256, role: "primary-framework", format: "text" });
  assert.equal(history.some((item) => item.file === R10_FILE), false, "the active revision is not in its own history");
  assert.equal(history.filter((item) => item.file === R9_FILE).length, 1);
  assert.match(manifest.notes, /October 31 owner-approved spiritual-source paragraph \(owner question 52, option A, answered 31 October 2026 at 23:29 UTC, with the owner's follow-up recorded on issue 215, comment 6546274735, item 2\) is a new revision, r10, that adds one paragraph to r9, in the Ask God for a Loan section directly after the paragraph that begins 'This is the feast problem\.'/u);
  assert.match(manifest.notes, /r9 stays immutable and moves into the source history\.$/u);
  // The notes that say the issue 215 edits were made inside r9 are still there: that is what happened to r9.
  assert.match(manifest.notes, /Inner Child refinements, filed as issue 215 on 31 October 2026 at 13:39 UTC, are made inside this same r9 file rather than a new revision/u);

  const layout = json("../guides/source-layout.json");
  const bindings = json("../tasks/guide-fidelity-20260906/case-source-bindings-2026-09-07.json");
  const concept = json("../authoring/concepts/shame.json");
  assert.equal(layout.version, "source-layout-v16-2026-10-31");
  assert.equal(layout.textGuides.find((guide) => guide.guideId === "inner-child-guide").file, active.file);
  assert.equal(bindings.sourceFile, `guides/${active.file}`);
  assert.equal(bindings.sourceSha256, active.sha256);
  assert.equal(concept.source.file, active.file);
  assert.equal(concept.source.sha256, active.sha256);
  assert.equal(json("../guide-graphs/compiled/bundle.json").sourceMaps.find((map) => map.guideId === "inner-child-guide").file, active.file);
  assert.match(read("../docs/CONCEPT-SOURCE-READING.md"), /The exact current authority is the October 31 r10 AI-guide candidate/u);
  assert.equal(read("../docs/CONCEPT-SOURCE-READING.md").includes(CURRENT_R9_SHA256), false);
  // The owner amendments are not touched by this change.
  const amendments = json("../guides/owner-amendments.json");
  assert.equal(amendments.version, "owner-amendments-2026-10-31-r21");
  assert.equal(amendments.items.length, 74);
  assert.equal(manifest.sources.find((source) => source.id === "owner-amendments").version, amendments.version);
});

test("IC.BORROW_LOVE gains the one line, last, once, and it is the only node that carries it", async () => {
  const borrow = node(candidateGraph, NODE);
  assert.ok(borrow.sourceRefs.includes(SECTION), "the node already cites Ask God for a Loan, so no source reference was needed");
  assert.deepEqual(borrow.sourceRefs, [
    "IC.LOVE_MISSING", "IC.HEART_SOLAR_LOOP", "AMEND.IC.BORROW_LOVE_EXTERNAL", "AMEND.IC.WELLBEING_HORIZON", "AMEND.IC.EMOTIONAL_TASK_GUIDANCE",
    "AMEND.IC.WISDOM_CORE", SECTION, "IC.ALTERED_STATES", "AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014", "AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029"
  ], "the references are as they were");
  assert.equal(borrow.recommendations.length, 10);
  assert.equal(borrow.recommendations.at(-1), NODE_LINE, "appended after the nine earlier recommendations");
  assert.equal(count(JSON.stringify(borrow), NODE_LINE), 1);
  // Everything else about the node is exactly as it was: the node without its new line is the node on main before this change.
  assert.equal(sha256(JSON.stringify({ ...borrow, recommendations: borrow.recommendations.slice(0, -1) })), BORROW_LOVE_BEFORE_SHA256);
  assert.equal(borrow.avoid.length, 3);
  assert.deepEqual(borrow.effects.deferNodes, ["ROUTE.GRATITUDE_PRACTICE"]);
  assert.deepEqual(borrow.effects.blockNodes, []);
  assert.equal(borrow.effects.requiredNuance.length, 4);
  assert.deepEqual(borrow.activation.all, [{ field: "love_access", op: "in", value: ["accessible", "limited"] }]);

  // The line is in no other node of any graph, candidate or compiled, and no node, edge or section was added.
  const candidateFiles = fs.readdirSync(new URL("../guide-graphs/candidates/", import.meta.url)).filter((file) => file.endsWith(".graph.json")).sort();
  const holders = candidateFiles.flatMap((file) => json(`../guide-graphs/candidates/${file}`).nodes.filter((candidate) => JSON.stringify(candidate).includes(NODE_LINE)).map((candidate) => candidate.id));
  assert.deepEqual(holders, [NODE]);
  const anyOtherNode = candidateFiles.flatMap((file) => json(`../guide-graphs/candidates/${file}`).nodes.filter((candidate) => candidate.id !== NODE && /deeper spiritual level|neither affirm nor deny what it is/iu.test(JSON.stringify(candidate))).map((candidate) => candidate.id));
  assert.deepEqual(anyOtherNode, [], "no other node carries the paragraph's idea in these words");

  // No other node and no edge changed: all other nodes and all edges of the four candidate graphs digest to what they were before this change.
  // This is a statement about this change's scope, so a later change to any other node re-pins it on purpose.
  const outside = candidateFiles.map((file) => {
    const graph = json(`../guide-graphs/candidates/${file}`);
    return { name: file.replace(/\.graph\.json$/u, ""), nodes: graph.nodes.filter((candidate) => candidate.id !== NODE), edges: graph.edges };
  });
  assert.deepEqual(outside.map((item) => item.name), ["cross-guide", "inner-child", "inner-signal-hypnosis", "somatic"]);
  assert.equal(sha256(JSON.stringify(outside)), OTHER_NODES_AND_EDGES_SHA256);
  const bundle = json("../guide-graphs/compiled/bundle.json");
  assert.deepEqual(bundle.graphs.flatMap((graph) => graph.nodes).filter((candidate) => JSON.stringify(candidate).includes(NODE_LINE)).map((candidate) => candidate.id), [NODE]);
  assert.equal(node(bundle.graphs.find((graph) => graph.graphId === candidateGraph.graphId), NODE).recommendations.at(-1), NODE_LINE, "the compiled node carries the line");
  const compiled = await compileGuideGraphs({ write: false });
  assert.equal(compiled.stats.nodeCount, 87);
  assert.equal(compiled.stats.edgeCount, 126);
  assert.equal(compiled.stats.sourceSectionCount, 153);
  assert.equal(compiled.stats.ownerAmendmentCount, 74);
  assert.equal(candidateGraph.nodes.length, 46);
  assert.equal(candidateGraph.edges.length, 58);
  const ids = candidateGraph.nodes.map((candidate) => candidate.id);
  assert.equal(new Set(ids).size, ids.length);

  // The other nodes that cite the same section were not given the line, and still cite it.
  const sectionCiters = candidateFiles.flatMap((file) => json(`../guide-graphs/candidates/${file}`).nodes.filter((candidate) => (candidate.sourceRefs ?? []).includes(SECTION)).map((candidate) => candidate.id)).sort();
  assert.deepEqual(sectionCiters, ["IC.ADULT_APPRENTICE", NODE, "IC.BORROW_ONE_FUNCTION", "IC.DEEP_CHILD_DIALOGUE", "IC.DEEP_LOVE_TO_CHILD", "ROUTE.GRATITUDE_PRACTICE"].sort());
});

test("the line is conditioned on what the person reports, keeps discernment, and neither affirms nor denies what the contact is", () => {
  assert.match(NODE_LINE, /^When a person reports contact with a deeper spiritual level of perfection, wisdom or compassion, it may bring release, love and reassurance in its own right and can help build the inner Nurturer, Protector and Guide; /u);
  assert.match(NODE_LINE, /do not treat it as a source of specific facts about ordinary life or let it replace discernment, so an impression that seems to come through it is tested like any other, and neither affirm nor deny what it is\.$/u);
  assert.equal(count(NODE_LINE, "neither affirm nor deny"), 1);
  // It is a condition on a report, not an assertion that such a level exists or that the person has reached it.
  assert.doesNotMatch(NODE_LINE, /^(?:There is|There are|There exists|The person has|Tell the person|Affirm)/iu);
  assert.doesNotMatch(NODE_LINE, /\b(?:exists?|is real|is true|proves?|confirms?)\b/iu);
  assert.match(NODE_LINE, /\bmay bring\b/u);
  // Written to InnerSignal about the person, naming no doctrine: not the Self, not Higher Self, not IFS.
  assert.doesNotMatch(NODE_LINE, /\byou(?:r|rs|rself)?\b/iu);
  assert.doesNotMatch(NODE_LINE, /\bSelf\b|\bIFS\b|Internal Family|neo-Advaita/u);
  assert.doesNotMatch(NODE_LINE, /\b(?:must|always|never|guarantee\w*)\b/iu);

  // Every phrase of the line is the paragraph's own, in the section it is bound to.
  const section = sourceMap.sections.find((candidate) => candidate.id === SECTION);
  const lines = read(`../guides/${sourceMap.file}`).split("\n");
  const sectionText = lines.slice(section.lineStart - 1, section.lineEnd).join("\n").toLowerCase().replaceAll("’", "'");
  for (const piece of ["deeper spiritual level of perfection, wisdom", "release, love", "reassurance in its own right", "nurturer, protector", "source of specific facts about ordinary life",
    "replace discernment", "an impression that seems to come through it", "tested like any other"]) {
    assert.ok(NODE_LINE.toLowerCase().includes(piece), `the line carries: ${piece}`);
    assert.ok(sectionText.includes(piece), `the section says: ${piece}`);
  }
  // "neither affirm nor deny" is the line's: the guide's paragraph does not use it, and the node says the same of metaphysical fact elsewhere.
  assert.equal(sectionText.includes("neither affirm nor deny"), false);
  const love = JSON.stringify(json("../guide-graphs/compiled/bundle.json").graphs.flatMap((graph) => graph.nodes).find((candidate) => candidate.id === "ROUTE.INFLUENCE_LOVE_CAPACITY"));
  assert.match(love, /without affirming or denying metaphysical fact/u);
});

test("the real planner puts the line in front of the model where IC.BORROW_LOVE applies, and nowhere else", async () => {
  const { graphs } = await compileGuideGraphs({ write: false });
  const scene = json("../corpus/graph-cases/G003.json");
  const plan = planFromGraphs({ graphs, variables: scene.variables, turnTask: null, unknowns: scene.unknowns ?? [] });
  const selected = plan.selectedNodes.find((candidate) => candidate.id === NODE);
  assert.ok(selected, "IC.BORROW_LOVE is selected for a person with accessible outside love and no self-directed love");
  assert.equal(selected.recommendations.filter((line) => line === NODE_LINE).length, 1);
  assert.equal(selected.recommendations.at(-1), NODE_LINE);
  assert.equal(plan.selectedNodes.filter((candidate) => candidate.id !== NODE && candidate.recommendations.includes(NODE_LINE)).length, 0);
  assert.equal(plan.primaryJob.id, "IC.BORROW_ONE_FUNCTION", "the node is a secondary job here, as before");
  assert.equal(plan.secondaryJobs.find((job) => job.id === NODE).tier, 4);

  // The node's activation is untouched, so the ordering is too: where the person is not safe the safety orientation stays the primary job, and
  // the node (still a tier 4 secondary job, as it was before this change) is not the primary job that carries the reply.
  const unsafe = planFromGraphs({ graphs, variables: { ...scene.variables, present_safety: "unsafe" }, turnTask: null, unknowns: [] });
  assert.equal(unsafe.primaryJob.id, "IC.SAFETY_ORIENTATION");
  assert.equal(unsafe.primaryJob.tier, 1);
  assert.equal(unsafe.selectedNodes[0].id, "IC.SAFETY_ORIENTATION");
  assert.equal(unsafe.selectedNodes[0].recommendations.includes(NODE_LINE), false, "the line is not on the safety node");
});

test("the humanized-guide queue carries PGQ-055 in the existing format, keeps every earlier entry, and says the humanized guide is reviewed in its own lane", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^Status: \*\*PENDING\*\*$/mu);
  assert.match(queue, /^Queue version: 2026-10-31-r20$/mu);
  const entry = (id) => {
    const start = queue.indexOf(`\n### ${id} — `);
    assert.ok(start >= 0, `${id} is queued`);
    const ends = ["\n### ", "\n## "].map((marker) => queue.indexOf(marker, start + 5)).filter((position) => position !== -1);
    return queue.slice(start + 1, ends.length ? Math.min(...ends) : undefined);
  };
  assert.match(queue, /^## Pending bundle O — a deeper spiritual level, and what it is not \(owner question 52\)$/mu);
  assert.ok(queue.indexOf("## Pending bundle O — ") > queue.indexOf("## Pending bundle N — "), "after the earlier bundles");
  assert.match(queue, /^### PGQ-055 — A deeper spiritual level can bring release, love and reassurance, but it is not a source of facts about ordinary life and does not replace discernment$/mu);
  assert.equal(count(queue, "\n### PGQ-055 — "), 1);
  const text = entry("PGQ-055");
  const lines = text.split("\n");
  for (const field of ["Caused by", "Teaching point", "Reader need", "Already covered", "Where"]) assert.equal(lines.filter((line) => line.startsWith(`${field}: `)).length, 1, field);
  assert.equal(lines.find((line) => line.startsWith("Teaching point: ")), `Teaching point: ${PARAGRAPH}`, "the teaching point is the paragraph, word for word");

  const caused = lines.find((line) => line.startsWith("Caused by: "));
  for (const part of ["Owner answer 52a of 31 Oct 2026, 23:29 UTC", "owner question 52", "“52a that's for the AI guide, humanized guide still want to review in its own lane”",
    "31 Oct 2026, 15:11 UTC", "issue 215", "comment 6546274735, item 2", "summarized there in the lane's own words", R10_FILE, SECTION, "This is the feast problem.", NODE,
    "The owner's merge of the pull request that carries r10 is the final approval"]) {
    assert.ok(caused.includes(part), `Caused by: ${part}`);
  }
  // The owner's instruction, in his words, and the limit of the entry.
  const where = lines.find((line) => line.startsWith("Where: "));
  assert.match(where, /^Where: Humanized public guide only, not the AI guide, and only where the owner chooses to place it\./u);
  assert.ok(where.includes("“humanized guide still want to review in its own lane”"));
  assert.match(where, /a pending queue entry is not publication authority\.$/u);
  assert.doesNotMatch(text, /\r/u);
  assert.ok(!lines.some((line, index) => index > 0 && line.startsWith("#")), "nothing in the entry reads as a new heading");

  // "Already covered" gives honest anchors: each quoted sentence is on the r10 line the entry names, in the section the entry names.
  const r10Lines = read(`../guides/${R10_FILE}`).split("\n");
  const covered = lines.find((line) => line.startsWith("Already covered: "));
  const at = (label, sectionId, lineNumber, quote) => {
    assert.ok(covered.includes(label) && covered.includes(`r10 line ${lineNumber}`), label);
    assert.ok(r10Lines[lineNumber - 1].includes(quote), `${label} is on r10 line ${lineNumber}`);
    const section = sourceMap.sections.find((candidate) => candidate.id === sectionId);
    assert.ok(section.lineStart <= lineNumber && lineNumber <= section.lineEnd, `${label} is in ${sectionId}`);
  };
  at("“Borrow Hindsight” (IC.GUIDE_LATER", "IC.GUIDE_LATER", 663, "a fallible perspective to borrow, not proof that a perfect Higher Self is waiting underneath everything");
  at("“How This Relates to IFS” (IC.IFS", "IC.IFS", 1019, "no use for another neo-Advaita, spiritual-bypassing claim that a perfect Higher Self is already waiting underneath everything");
  at("“Start With Whatever Showed Up” (IC.START_WHATEVER", "IC.START_WHATEVER", 467, "A voice, intuition, or presence can offer information without taking the steering wheel");
  assert.equal(r10Lines[660], "Borrow Hindsight");
  assert.equal(r10Lines[1010], "How This Relates to IFS");
  assert.equal(r10Lines[450], "Start With Whatever Showed Up");
  assert.ok(covered.includes("None of them says that there may be a deeper spiritual level"), "and it says what none of them covers");

  // PGQ-050 is kept, and its line anchors follow the guide it names (r10 puts two lines before them).
  const schema = entry("PGQ-050");
  assert.match(schema, /\(IC\.RELATED_CLINICAL_WORK, r10, lines 1029–1046\)/u);
  assert.match(schema, /changes nothing in the AI guide \(`inner-child-guide-2026-10-31-r10\.txt`\)/u);
  assert.doesNotMatch(schema, /\b(?:r8|r9)\b/u, "no stale anchor remains in the entry");
  // Every entry that was there before is still there, exactly once.
  const before = [...Array.from({ length: 43 }, (_, index) => `PGQ-${String(index + 1).padStart(3, "0")}`), ...["047", "048", "049", "050", "051", "052", "053", "054"].map((id) => `PGQ-${id}`)];
  for (const id of before) assert.equal(count(queue, `\n### ${id} — `), 1, id);
  // Nothing was consumed, so the sync file is as it was: the inner-child public edition is still a planned, separate one.
  const sync = json("../authoring/public-guide-sync.json");
  assert.equal(sync.version, "public-guide-sync-v2-2026-09-16");
  assert.equal(sync.guides.find((guide) => guide.id === "inner-child").status, "PLANNED_SEPARATE_HUMANIZED");
});

test("the lesson and the state section record the change and what is not done", () => {
  const lessons = read("../THERAPY-LESSONS");
  const title = "## 2026-10-31 — A deeper spiritual level can be opened to, but it is not a source of facts about ordinary life and does not replace discernment";
  assert.equal(count(lessons, `\n${title}\n`), 1);
  const start = lessons.indexOf(title);
  const lesson = lessons.slice(start, lessons.indexOf("\nThis root log records", start));
  for (const part of ["Development candidate, not deployed", "Owner answer 52a", "owner question 52", "23:29 UTC", "that's for the AI guide, humanized guide still want to review in its own lane", "issue 215", "comment 6546274735, item 2",
    "neither affirms nor denies what it is", "conditioned on what the person reports", R10_FILE, SECTION, "This is the feast problem.", "When the Spiritual Relationship Hurts", NODE,
    "taking the paragraph out gives r9 back byte for byte", "owner-amendments-2026-10-31-r21", "PROTECTIVE-COMPATIBILITY.md", "no plugin rule was added", "ALREADY COVERED", "Borrow Hindsight", "How This Relates to IFS",
    "Start With Whatever Showed Up", "PGQ-055", "queue r20", "will review in its own lane", "not publication authority", "tests/spiritual-source-paragraph.test.mjs", "do not show that any model follows the line",
    "Merged: no", "Public text published: no", "Therapy protocol served live: no"]) {
    assert.ok(lesson.includes(part), part);
  }
  assert.doesNotMatch(lesson, /https?:|@/u, "no link or address in the lesson");
  assert.equal(lesson.includes("<!-- therapy-lesson"), false, "a development candidate carries no machine-read marker, so the runtime does not load it");

  const state = read("../state/CODEX-CURRENT-STATE.md");
  assert.equal((state.match(/^Updated: /gmu) ?? []).length, 1, "exactly one Updated line");
  const heading = "## Spiritual source paragraph — owner answer 52a (2026-10-31; branch `feat/spiritual-source-paragraph-20261031`, a draft pull request to `main`, not merged, not installed)";
  assert.equal(count(state, `\n${heading}\n`), 1);
  const from = state.indexOf(heading);
  assert.ok(from > 100, "the state section exists, away from the top of the file");
  const section = state.slice(from, state.indexOf("\n## ", from + 5));
  for (const part of ["52a", "23:29 UTC", "issue 215", "comment 6546274735", R10_FILE, R10_SHA256.slice(0, 8), CURRENT_R9_SHA256.slice(0, 8), "byte for byte", "sourceHistory", "source-layout-v16", "owner-approved-spiritual-source-paragraph-2026-10-31-r10",
    SECTION, "lines 281–294", "two lines lower", NODE, "no source reference was added", "neither affirm nor deny", "owner-amendments-2026-10-31-r21", "PROTECTIVE-COMPATIBILITY.md", "no plugin rule was added",
    "ALREADY COVERED", "PGQ-055", "2026-10-31-r20", "1029–1046", "not publication authority", "npm run graph:compile", "npm run authoring:project", "npm run authoring:maps", "byte-equal by hand",
    "tests/spiritual-source-paragraph.test.mjs", "development merged: no", "Public text published: no", "Therapy protocol served live: no", "Next safe action"]) {
    assert.ok(section.includes(part), part);
  }
  // The earlier sections about the same batch are still there and still say what they said at the time.
  for (const earlier of ["## Critical inner voice, guard distinction and optional anger drawing — owner-approved refinements, issue 215", "## Intention, expected reaction and later judgment after a conflict — owner answer 51a"]) {
    assert.equal(count(state, `\n${earlier}`), 1, earlier);
  }
  assert.ok(from > state.indexOf("## Critical inner voice, guard distinction and optional anger drawing"), "the new section follows the issue 215 section");
});

test("the plugin map copy is the repository's, byte for byte, and no plugin file carries the paragraph or the line", () => {
  const map = read("../docs/INNER-CHILD-THERAPY-MAP.md");
  assert.equal(read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md"), map);
  const projection = json("../authoring/obsidian/current/manifest.json");
  assert.match(projection.projectionInputSha256, /^[0-9a-f]{64}$/u);
  assert.ok(map.includes(`> Projection input: \`${projection.projectionInputSha256}\``), "the map was regenerated from the current projection");
  const note = read(`../authoring/obsidian/current/nodes/inner-child-directed-graph/${NODE}.md`);
  assert.ok(note.includes(NODE_LINE), "the projected node note carries the line");
  assert.ok(read(`../authoring/obsidian/current/sources/inner-child-guide/${SECTION}.md`).includes(`Authority path: \`guides/${R10_FILE}\``));
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(new URL(directory, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${directory}${entry.name}/`);
      else files.push(`${directory}${entry.name}`);
    }
  };
  walk("../plugins/inner-signal-therapy/");
  assert.equal(files.length, 12, "the plugin keeps its 12 files");
  for (const file of files) {
    const text = read(file);
    assert.equal(text.includes(NODE_LINE) || text.includes(PARAGRAPH) || /deeper spiritual level/iu.test(text), false, `${file} carries no spiritual-source rule`);
  }
});
