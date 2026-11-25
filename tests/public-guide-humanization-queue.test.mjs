import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
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

// The reset of 2026-11-04 consumed PGQ-001 to PGQ-055; none of them may be queued again.
const CONSUMED_ON_RESET = /^### PGQ-0(?:0[1-9]|[1-4]\d|5[0-5]) — /mu;
const syncRecord = async () => JSON.parse(await read("authoring/public-guide-sync.json")).guides.find((guide) => guide.id === "inner-child");
const assertConsumed = (queue, obligations, id, fate, status) => {
  assert.ok(!queue.includes(`### ${id} — `), `${id} is no longer queued`);
  const records = obligations.filter((record) => record.id === id);
  assert.equal(records.length, 1, `${id} has one obligation record`);
  assert.equal(records[0].fate, fate, `${id} fate`);
  assert.equal(records[0].status, status, `${id} status`);
};

test("guide r8's two owner-approved additions are consumed, and the legal review names the accidental-exposure sentence's entry", async () => {
  const [queue, record] = await Promise.all([read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"), syncRecord()]);
  assert.equal(record.queueConsumption.resetTo, "2026-11-04-r21 (EMPTY)");
  assert.doesNotMatch(queue, CONSUMED_ON_RESET, "no entry consumed on 2026-11-04 is queued again");
  assertConsumed(queue, record.queueConsumption.obligations, "PGQ-048", "core point in", "SYNCED");
  assertConsumed(queue, record.queueConsumption.obligations, "PGQ-049", "core point in", "SYNCED");
  // PGQ-039 and PGQ-048 asked for a legal review before public placement; the consumption record says how it was settled.
  assert.match(record.queueConsumption.legalReview, /PGQ-039/u);
  assert.match(record.queueConsumption.legalReview, /PGQ-048/u);
});

test("PGQ-050 is consumed from the humanized-guide queue, and the AI guide still does not carry the schema-therapy comparison", async () => {
  const [queue, guide, agents, record] = await Promise.all([
    read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"),
    read("guides/inner-child-guide-2026-10-31-r10.txt"),
    read("AGENTS.md"),
    syncRecord()
  ]);
  assertConsumed(queue, record.queueConsumption.obligations, "PGQ-050", "core point in", "SYNCED");
  assert.match(agents, /authoring\/PENDING-PUBLIC-GUIDE-CHANGES\.md/);

  // The AI guide's related-work section is where the entry was anchored (r10 puts two lines before the old anchors).
  const related = JSON.parse(await read("guide-graphs/source-maps/inner-child-guide.json")).sections.find(section => section.id === "IC.RELATED_CLINICAL_WORK");
  assert.deepEqual([related.lineStart, related.lineEnd], [1029, 1046]);
  assert.equal(guide.split("\n")[related.lineStart - 1], "Related Clinical Work");
  // The anchor really says what it was said to say, and the comparison is not in the AI guide or the app.
  assert.match(guide, /Related Clinical Work\n\nThis framework developed through the teachers and collaborators credited below[^\n]*comparisons with schema therapy/u);
  assert.ok(!guide.includes("Punitive Parent"), "the AI guide does not carry the comparison");
  assert.ok(!guide.includes("Schema therapy, developed by Jeffrey Young and colleagues, i"));
});

test("the reset of 2026-11-04-r21 consumed exactly 52 entries, none of which is queued again, and the sync record covers each", async () => {
  const [queue, record] = await Promise.all([read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"), syncRecord()]);
  assert.equal(record.queueConsumption.resetTo, "2026-11-04-r21 (EMPTY)");
  assert.doesNotMatch(queue, CONSUMED_ON_RESET, "no entry consumed on 2026-11-04 is queued again");

  const consumption = record.queueConsumption;
  const expectedIds = Array.from({ length: 55 }, (_, index) => `PGQ-${String(index + 1).padStart(3, "0")}`)
    .filter((id) => !["PGQ-044", "PGQ-045", "PGQ-046"].includes(id));
  assert.equal(expectedIds.length, 52);
  assert.deepEqual(consumption.obligations.map((entry) => entry.id), expectedIds, "each ID once, in order");

  const tally = { in: 0, "core point in": 0, "left out": 0 };
  for (const entry of consumption.obligations) {
    assert.ok(entry.fate in tally, `${entry.id} has a known fate`);
    tally[entry.fate] += 1;
    assert.equal(entry.status, entry.fate === "left out" ? "NOT_PUBLIC" : "SYNCED", `${entry.id} status follows its fate`);
    if (entry.fate !== "in") assert.ok(typeof entry.notes === "string" && entry.notes.trim().length > 0, `${entry.id} has notes`);
  }
  assert.deepEqual(consumption.counts, { entries: 52, in: 26, corePointIn: 25, leftOut: 1 });
  assert.deepEqual([tally.in, tally["core point in"], tally["left out"]], [26, 25, 1]);

  assert.match(record.humanizedDraft.sha256, /^[0-9a-f]{64}$/);
});

test("the queue change passes the same guide-change provenance rules as continuous integration", () => {
  // Synthetic queues: the real entries are consumed and live only in history.
  const entry = (id, body) => `### ${id} — A synthetic teaching point\nCaused by: A synthetic owner request\nTeaching point: ${body}\nReader need: A synthetic reader need\nAlready covered: A synthetic anchor, the heading “Synthetic Section” of the public guide\nWhere: A synthetic place in the guide\n`;
  const before = `Status: **PENDING**\nQueue version: synthetic-r1\n\n${entry("PGQ-900", "First point.")}`;
  const after = `Status: **PENDING**\nQueue version: synthetic-r2\n\n${entry("PGQ-900", "First point.")}\n${entry("PGQ-901", "Second point.")}`;
  const changedPaths = [
    "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md",
    "guide-graphs/candidates/inner-child.graph.json",
    "src/prompts/response-fidelity.mjs"
  ];
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: before, newQueue: after }), []);
  // Without the queue entry the same graph and prompt edits would be refused.
  assert.deepEqual(
    assessGuideChangeProvenance({ changedPaths: changedPaths.slice(1), oldQueue: before, newQueue: before }),
    ["Map/guide/prompt changes require a queue update or reasoned app-only declaration."]
  );
  // Consuming an entry (removing it) needs the sync file in the same change.
  const emptied = "Status: **EMPTY**\nQueue version: synthetic-r3\n";
  assert.deepEqual(
    assessGuideChangeProvenance({ changedPaths: ["authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"], oldQueue: before, newQueue: emptied }),
    ["Consumed obligations require the public-guide sync-manifest update."]
  );
  assert.deepEqual(
    assessGuideChangeProvenance({ changedPaths: ["authoring/PENDING-PUBLIC-GUIDE-CHANGES.md", "authoring/public-guide-sync.json"], oldQueue: before, newQueue: emptied }),
    []
  );
});

test("the consolidated inner-child guide obligations are consumed, not queued", async () => {
  const [queue, record] = await Promise.all([read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"), syncRecord()]);
  // Experience is not its own interpretation (001), reciprocal social practice (002), a healthy mind is not a perfectly clean one (007),
  // missing as an optional cue for love (008), speaking toward what is being built (010), the opening map leaving the exercise (012)
  // and the transfer mismatch (013).
  for (const [id, fate] of [["PGQ-001", "in"], ["PGQ-002", "in"], ["PGQ-007", "in"], ["PGQ-008", "in"], ["PGQ-010", "in"], ["PGQ-012", "in"], ["PGQ-013", "core point in"]]) {
    assertConsumed(queue, record.queueConsumption.obligations, id, fate, "SYNCED");
  }
});

test("the 20 Nov 2026 entries record where each r11 passage came from, and pass the same provenance rules as continuous integration", async () => {
  const [queue, guide, record, amendmentFile] = await Promise.all([
    read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"),
    read("guides/inner-child-guide-2026-11-20-r11.txt"),
    syncRecord(),
    read("guides/owner-amendments.json")
  ]);
  assert.match(queue, /^Status: \*\*PENDING\*\*$/m);
  // r24 (21 Nov 2026) adds PGQ-089, the owner's 19 Oct 2026 symptom line (IS7), after the 20 Nov entries; its own test is below.
  // r25 (25 Nov 2026) adds PGQ-090, guide r12's Generational Trauma passage (tests/guide-generational-trauma-20261125.test.mjs), and
  // PGQ-091 and PGQ-092 for the owner's answer i79 of the same day (tests/owner-answer-i79-20261125.test.mjs).
  assert.match(queue, /^Queue version: 2026-11-25-r25$/m);
  const expected = Array.from({ length: 33 }, (_, index) => `PGQ-${String(56 + index).padStart(3, "0")}`);
  assert.deepEqual([...queue.matchAll(/^### (PGQ-\d+) — /gm)].map((match) => match[1]), [...expected, "PGQ-089", "PGQ-090", "PGQ-091", "PGQ-092"], "PGQ-056 to PGQ-088 (the owner's answer on guards, point 16, 22:27 UTC), then PGQ-089 to PGQ-092, once each, in order");

  const bundle = record.ownerDecisions20261120;
  assert.deepEqual(bundle.obligations.map((entry) => entry.id), expected, "one provenance record per queued entry");
  assert.equal(bundle.liveGuide.updatedAt, "2026-11-20T01:19:09.988Z");
  assert.equal(bundle.ownerAnswers.at, "2026-11-20T01:18:01Z");
  assert.equal(bundle.canonical.sha256, createHash("sha256").update(guide, "utf8").digest("hex"), "the record names the r11 bytes");

  // Every r11 passage has exactly one entry, whose line range starts at that passage's "From" line and names the live guide and his answers.
  const lines = guide.split("\n");
  const fromLines = lines.flatMap((line, index) => (index + 1 > bundle.canonical.lines[0] && line.startsWith("From “") ? [index + 1] : []));
  const fromR11 = bundle.obligations.filter((entry) => entry.r11Lines);
  assert.equal(fromLines.length, 28);
  assert.deepEqual(fromR11.map((entry) => entry.r11Lines[0]), fromLines);
  for (const entry of fromR11) {
    const [start, end] = entry.r11Lines;
    assert.ok(lines[start - 1].startsWith(`From “${entry.livePart ? "The same section" : entry.liveHeading}`), `${entry.id} names its passage's live heading`);
    assert.ok(end >= start + 2 && lines[end - 1].trim(), `${entry.id} covers the passage text`);
    const body = queue.slice(queue.indexOf(`### ${entry.id} — `)).split("\n### ")[0];
    assert.match(body, new RegExp(`lines ${start}–${end}\\) quotes this word for word from the owner's live guide \\(Substack post as updated 2026-11-20T01:19:09Z\\), and he adopted it in his answers of 20 Nov 2026 01:18 UTC`, "u"));
    for (const amendment of entry.amendments) assert.ok(body.includes(amendment), `${entry.id} names ${amendment}`);
  }
  const amendments = new Set(JSON.parse(amendmentFile).items.map((item) => item.id));
  for (const entry of bundle.obligations) for (const amendment of entry.amendments) assert.ok(amendments.has(amendment), `${entry.id}: ${amendment} is an owner amendment`);

  // Against the EMPTY queue it replaced, the change passes the rules continuous integration applies.
  const emptied = "Status: **EMPTY**\nQueue version: 2026-11-04-r21\n";
  const changedPaths = ["guides/inner-child-guide-2026-11-20-r11.txt", "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md", "authoring/public-guide-sync.json"];
  assert.deepEqual(assessGuideChangeProvenance({ changedPaths, oldQueue: emptied, newQueue: queue }), []);
});
