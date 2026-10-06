import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

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
