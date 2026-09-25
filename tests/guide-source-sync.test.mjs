import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { verifySourceSync as verifyHistoricalSourceSync } from "../tasks/guide-source-sync-20260907/verify.mjs";
import { verifyLatestSourceSync } from "../tasks/reparenting-strategy-refinement-20260925/verify_source_sync.mjs";

test("historical September 7 source remains exactly reconstructible from adopted E01-E12", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-09-07.txt", import.meta.url), "utf8");
  const result = await verifyHistoricalSourceSync({ candidateText: text });
  assert.equal(result.operations, 12);
  assert.equal(result.unexplainedChanges, 0);
});

test("current September 25 source is pinned to the exact owner capture and operational text", async () => {
  const result = await verifyLatestSourceSync();
  assert.equal(result.status, "PASS");
  assert.equal(result.sourceHistoryPreserved, true);
  assert.equal(result.semanticStatus, "source-synchronized-only");
});

test("current source preservation proof rejects both loss and unapproved extra wording", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-09-25.txt", import.meta.url), "utf8");
  await assert.rejects(() => verifyLatestSourceSync({ candidateText: text.slice(1) }));
  await assert.rejects(() => verifyLatestSourceSync({ candidateText: text + "\nUnapproved extra claim." }));
});
