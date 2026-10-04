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

test("October 3 r3 source remains exact and pinned after the October 4 successor", async () => {
  const result = await verifyOct3SourceSync();
  assert.equal(result.status, "PASS");
  assert.equal(result.sourceHistoryPreserved, true);
  assert.equal(result.semanticStatus, "owner-approved-certainty-authenticity-refinement-r3");
});

test("October 4 active source is an exact authorized insertion-only delta over October 3 r3", async () => {
  const prior = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r3.txt", import.meta.url), "utf8");
  const current = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-04-r1.txt", import.meta.url), "utf8");
  assert.equal(hash(current), "08b27742b0daa4907bbd995cc61ec3d750eb6b13d215863a70bb47f8060fbcac");

  const priorLines = prior.split("\n");
  let priorIndex = 0;
  for (const line of current.split("\n")) {
    if (priorIndex < priorLines.length && line === priorLines[priorIndex]) priorIndex += 1;
  }
  assert.equal(priorIndex, priorLines.length, "October 4 may add authorized material but must preserve every October 3 r3 line in order");

  for (const marker of [
    "You do not graduate into inner-not-signal",
    "This is not throwing yourself into a cauldron to toughen up",
    "If isolation itself is part of the wound, reaching toward people can be reparenting in action",
    "A difficult dream is not automatically evidence that the practice helped"
  ]) {
    assert.equal(current.split(marker).length - 1, 1, marker);
    assert.equal(prior.includes(marker), false, marker);
  }

  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  const active = manifest.sources.find(source => source.id === "inner-child-guide");
  assert.equal(active.version, "owner-approved-continuity-scaffolding-2026-10-04-r1");
  assert.equal(active.file, "inner-child-guide-2026-10-04-r1.txt");
  assert.equal(active.sha256, "08b27742b0daa4907bbd995cc61ec3d750eb6b13d215863a70bb47f8060fbcac");
  assert.ok(manifest.sourceHistory.some(item =>
    item.id === "inner-child-guide"
    && item.version === "owner-latest-humanized-2026-10-03-r3"
    && item.sha256 === "3bbce295094b1c315112ddd831af9f54226b4e8b7b84105908ea15322526eedb"
  ));
});

test("current source preservation proof rejects both loss and unapproved extra wording", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r3.txt", import.meta.url), "utf8");
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text.slice(1) }));
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text + "\nUnapproved extra claim." }));
});
