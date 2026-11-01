import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { assessGuideChangeProvenance } from "../scripts/check-guide-change-provenance.mjs";

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public-guide humanization bootstrap always points to the durable pending queue", async () => {
  const [agents, humanization, queue] = await Promise.all([
    read("AGENTS.md"),
    read("docs/PUBLIC-GUIDE-HUMANIZATION.md"),
    read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md")
  ]);

  assert.match(agents, /docs\/PUBLIC-GUIDE-HUMANIZATION\.md/);
  assert.match(agents, /authoring\/PENDING-PUBLIC-GUIDE-CHANGES\.md/);
  assert.match(agents, /same reviewed change/i);
  assert.match(agents, /EMPTY sentinel/i);

  assert.match(humanization, /Pending change queue/);
  assert.match(humanization, /same reviewed change/);
  assert.match(humanization, /Runtime-only mechanics do not require/);
  assert.match(humanization, /remove only those consumed items/);
  assert.match(humanization, /reset the queue to its `EMPTY` sentinel/);

  const statusLine = queue.split(/\r?\n/).find((line) => line.startsWith("Status:")) ?? "";
  const pending = statusLine === "Status: **PENDING**";
  const empty = statusLine === "Status: **EMPTY**";
  assert.notEqual(pending, empty, "queue must open with exactly PENDING or EMPTY");
  if (pending) assert.match(queue, /^### PGQ-\d+/m);
});

test("guide r8's two owner-approved additions are queued, and the accidental-exposure sentence is held for the legal check", async () => {
  const queue = await read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^Queue version: 2026-10-31-r20$/m);
  const entry = id => {
    const start = queue.indexOf(`### ${id} — `);
    assert.ok(start >= 0, `${id} is queued`);
    const next = queue.indexOf("\n#", start + 4);
    return queue.slice(start, next < 0 ? undefined : next);
  };
  const disclosure = entry("PGQ-048");
  const sequence = entry("PGQ-049");
  for (const text of [disclosure, sequence]) {
    for (const field of ["Caused by:", "Teaching point:", "Reader need:", "Already covered:", "Where:"]) {
      assert.match(text, new RegExp(`^${field} \\S`, "m"), field);
    }
    // The provenance of the approval: the owner's chat answer, its reading, and the revision that carries the wording.
    assert.match(text, /30 Oct 2026, 22:03 UTC, to owner question 46/u);
    assert.match(text, /“56a”/u);
    assert.match(text, /“46: A”/u);
    assert.match(text, /inner-child-guide-2026-10-30-r8\.txt/u);
    assert.match(text, /a pending queue entry is not publication authority/u);
  }
  assert.match(disclosure, /IC\.SHAME_APPRAISAL/u);
  assert.match(sequence, /IC\.RELATIONAL_REALITY/u);
  // Only the accidental-exposure sentence is marked: it goes into the public guide after the legal review this queue already requires.
  assert.match(disclosure, /\*\*Needs the legal check:\*\* the accidental-exposure sentence \(“If you came across illegal material by accident, …”\)/u);
  assert.match(disclosure, /only after the legal review this queue requires \(PGQ-039:/u);
  assert.doesNotMatch(sequence, /legal check|legal review/iu);
});

// The owner's request of 31 Oct 2026: a passage on how the guide differs from schema therapy, written for him to place in
// the humanized public guide. The queue keeps it word for word (title line, six paragraphs, source note); these are the words.
const SCHEMA_THERAPY_PASSAGE = [
  "**How this guide differs from schema therapy**",
  "Schema therapy, developed by Jeffrey Young and colleagues, is one of the best-known therapies built around reparenting, and I've learned from it. I kept three of its ideas: a need is different from the strategy someone uses to meet it; a pattern can be confronted with compassion; and what changes in a session has to carry over into ordinary life.",
  "This guide differs in four ways. Schema therapy maps a person's difficulties onto eighteen named schemas and a set of modes, such as the Vulnerable Child or the Punitive Parent, often with questionnaires. Here you describe what a part of you does and how it feels, in your own words, and there's no inventory to fill in.",
  "In Young's model each group of schemas comes with a typical family origin, such as a cold, rejecting or unpredictable home, so a label can slide into guessing what someone's childhood was like. Here, your history is what you tell, not what a label implies.",
  "In schema therapy the therapist reparents the client within the limits of the professional relationship, and the client's healthy adult side grows partly by modelling the therapist. Here, reparenting is something you learn to do for yourself. Anyone who helps along the way, a therapist, a friend or an AI helper, hands that role back to you.",
  "Young's practitioner's guide has therapist and client fight the harshest inner voice, the Punitive Parent, until it's defeated and expelled. This guide doesn't make war on any part of you. A harsh inner critic may once have tried to protect you: it gets heard, what's useful in it can be kept, and its contempt doesn't have to be obeyed.",
  "Schema therapy's research comes from long courses with trained therapists, mostly for personality disorders. It doesn't show that this guide works, and I don't claim it does.",
  "Source for the claims: Young, Klosko and Weishaar, *Schema Therapy: A Practitioner's Guide* (Guilford, 2003): schemas and typical family origins, Figure 1.1, p. 13; fighting, defeating and expelling the Punitive Parent, pp. 270, 307, 325; the healthy adult \"battling or moderating\" the parent modes, p. 305."
];

test("PGQ-050 queues the schema-therapy comparison for the humanized guide only, with the passage and its source note unchanged", async () => {
  const [queue, guide, agents] = await Promise.all([
    read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"),
    read("guides/inner-child-guide-2026-10-31-r10.txt"),
    read("AGENTS.md")
  ]);
  const heading = "### PGQ-050 — How this guide differs from schema therapy";
  const start = queue.indexOf(heading);
  assert.ok(start >= 0, "PGQ-050 is queued");
  assert.equal(queue.indexOf(heading, start + 1), -1, "PGQ-050 is queued once");
  const next = queue.indexOf("\n#", start + 4);
  const text = queue.slice(start, next < 0 ? undefined : next);

  for (const field of ["Caused by:", "Teaching point:", "Reader need:", "Already covered:", "Where:"]) {
    assert.match(text, new RegExp(`^${field} \\S`, "m"), field);
  }
  // Provenance: the owner asked for it, it was written for him to place, and it is proposed wording, not placed text.
  assert.match(text, /^Caused by: Owner request of 31 Oct 2026: /m);
  assert.match(text, /written for him at his request for him to place in the humanized public guide/u);
  assert.match(text, /The wording is proposed and not yet placed/u);
  assert.match(text, /changes nothing in the AI guide \(`inner-child-guide-2026-10-31-r10\.txt`\) or in the app/u);
  // Scope: the owner's humanized public guide only; the AI guide's own related-work section is the anchor, not the destination.
  assert.match(text, /^Where: Humanized public guide only, not the AI guide, and only where the owner chooses to place it;/m);
  assert.match(text, /IC\.RELATED_CLINICAL_WORK/u);
  // The line anchors are those of the current AI guide (r10, which put two lines before them), tied to its source map rather than remembered.
  const related = JSON.parse(await read("guide-graphs/source-maps/inner-child-guide.json")).sections.find(section => section.id === "IC.RELATED_CLINICAL_WORK");
  assert.deepEqual([related.lineStart, related.lineEnd], [1029, 1046]);
  assert.equal(guide.split("\n")[related.lineStart - 1], "Related Clinical Work");
  assert.match(text, /\(IC\.RELATED_CLINICAL_WORK, r10, lines 1029–1046\)/u);
  assert.doesNotMatch(text, /\b(?:r8|r9)\b/u, "no stale r8 or r9 anchor remains in the entry");
  assert.match(text, /a pending queue entry is not publication authority/u);
  assert.match(text, /does not check the cited pages/u);
  // The anchor really says what the entry says it says, and the passage is not already in the AI guide or the app.
  assert.match(guide, /Related Clinical Work\n\nThis framework developed through the teachers and collaborators credited below[^\n]*comparisons with schema therapy/u);
  assert.ok(!guide.includes("Punitive Parent"), "the AI guide does not already carry the comparison");
  assert.ok(!guide.includes(SCHEMA_THERAPY_PASSAGE[1].slice(0, 60)));

  // The passage itself: title line, six paragraphs, then the source note, word for word.
  assert.equal(SCHEMA_THERAPY_PASSAGE.length, 8);
  assert.equal(SCHEMA_THERAPY_PASSAGE[0], "**How this guide differs from schema therapy**");
  assert.match(SCHEMA_THERAPY_PASSAGE[7], /^Source for the claims: Young, Klosko and Weishaar, /u);
  const quoted = text.split("\n").filter(line => line.startsWith(">")).map(line => line.replace(/^> ?/u, "")).join("\n");
  assert.equal(quoted, SCHEMA_THERAPY_PASSAGE.join("\n\n"));
  assert.match(agents, /authoring\/PENDING-PUBLIC-GUIDE-CHANGES\.md/);

  // Nothing inside the entry can be read as a new heading, so the entry ends where the file's next one begins.
  assert.ok(!text.split("\n").some((line, index) => index > 0 && line.startsWith("#")));
});

test("the queue change passes the same guide-change provenance rules as continuous integration", async () => {
  const queue = await read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  const bundle = queue.indexOf("\n## Pending bundle L");
  assert.ok(bundle > 0, "PGQ-050 sits in its own bundle");
  const before = queue.slice(0, bundle).replace(/^Queue version: .*$/m, "Queue version: 2026-10-30-r16").trimEnd() + "\n";
  const changedPaths = [
    "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md",
    "guide-graphs/candidates/inner-child.graph.json",
    "src/prompts/response-fidelity.mjs"
  ];
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: queue }), []);
  // Without the queue entry the same graph and prompt edits would be refused.
  assert.deepEqual(
    assessGuideChangeProvenance({ changedPaths: changedPaths.slice(1), oldQueue: before, newQueue: before }),
    ["Map/guide/prompt changes require a queue update or reasoned app-only declaration."]
  );
});

test("current pending queue carries the consolidated inner-child guide obligations", async () => {
  const queue = await read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /Experience is not its own interpretation/);
  assert.match(queue, /Social practice should be reciprocal/);
  assert.match(queue, /A healthy mind is not a perfectly clean mind/);
  assert.match(queue, /Missing can become an optional cue for love/);
  assert.match(queue, /Speak toward what is being built/i);
  assert.match(queue, /practice-to-life transfer/i);
  assert.match(queue, /Make the opening map explicitly leave the exercise/);
  assert.match(queue, /Add the transfer mismatch under/);
});
