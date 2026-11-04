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
  assert.match(queue, /^Status: \*\*EMPTY\*\*$/m);
  assert.match(queue, /^Queue version: 2026-11-04-r21$/m);
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

test("the queue is EMPTY at 2026-11-04-r21, and the sync record covers exactly 52 consumed entries", async () => {
  const [queue, record] = await Promise.all([read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"), syncRecord()]);
  assert.match(queue, /^Status: \*\*EMPTY\*\*$/m);
  assert.match(queue, /^Queue version: 2026-11-04-r21$/m);
  assert.doesNotMatch(queue, /^### PGQ-/m);

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
