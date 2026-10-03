import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifySourceSync as verifyHistoricalSourceSync } from "../tasks/guide-source-sync-20260907/verify.mjs";
import { verifyOct3SourceSync } from "../tasks/inner-child-oct3-certainty-refinement-20261003/verify_source_sync.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

test("historical September 7 source remains exactly reconstructible from adopted E01-E12", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-09-07.txt", import.meta.url), "utf8");
  const result = await verifyHistoricalSourceSync({ candidateText: text });
  assert.equal(result.operations, 12);
  assert.equal(result.unexplainedChanges, 0);
});

test("historical September 25 source remains pinned byte for byte", async () => {
  const raw = await fs.readFile(new URL("../guides/source-captures/inner-child-guide-2026-09-25.substack.html", import.meta.url));
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-09-25.txt", import.meta.url));
  assert.equal(hash(raw), "20073058fef619d8a8f5aa7fef8337face5ed50cf89d17c8142138effdb125b6");
  assert.equal(hash(text), "2a743d9ec9f45ba12ce78f29f64eef84dfe930589281992ad530b01f0f2969a1");
});

test("current October 3 r2 source preserves the exact owner baseline and active edited bytes", async () => {
  const result = await verifyOct3SourceSync();
  assert.equal(result.status, "PASS");
  assert.equal(result.sourceHistoryPreserved, true);
  assert.equal(result.semanticStatus, "owner-approved-certainty-authenticity-refinement-r2");
});

test("current source preservation proof rejects both loss and unapproved extra wording", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r2.txt", import.meta.url), "utf8");
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text.slice(1) }));
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text + "\nUnapproved extra claim." }));
});
