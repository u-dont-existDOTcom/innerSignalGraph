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

test("October 3 r4 reader-facing source remains exact and pinned after the successor", async () => {
  const result = await verifyOct3SourceSync();
  assert.equal(result.status, "PASS");
  assert.equal(result.sourceHistoryPreserved, true);
  assert.equal(result.semanticStatus, "reader-facing-language-repair-r4");
});

test("October 4 r3 adds only the approved continuity material on top of reader-facing r4", async () => {
  const r4 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r4.txt", import.meta.url), "utf8");
  const r1 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-04-r1.txt", import.meta.url), "utf8");
  const r2 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-04-r2.txt", import.meta.url), "utf8");
  const current = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-04-r3.txt", import.meta.url), "utf8");
  assert.equal(hash(r4), "1ae4140f0c6acb900ff18ef961ca2e7a136c0812678e88e64f02dc4268ca08cb");
  assert.equal(hash(r1), "08b27742b0daa4907bbd995cc61ec3d750eb6b13d215863a70bb47f8060fbcac");
  assert.equal(hash(r2), "d110de6c48c4ea725fa99edf1d25b6badfa2bf764374b794fb17b93fe646d1a5");
  assert.equal(hash(current), "f2d285911a07a8ab0b189bc53914b535db68c88dbad66a529c69b41c08f9053e");

  const priorLines = r4.split("\n");
  let priorIndex = 0;
  for (const line of current.split("\n")) {
    if (priorIndex < priorLines.length && line === priorLines[priorIndex]) priorIndex += 1;
  }
  assert.equal(priorIndex, priorLines.length, "The successor must preserve every reader-facing r4 line in order");

  for (const markerText of [
    "A no to the frame is not a pacing problem to solve",
    "If those answers are not known yet, do not rush to classify the experience as healing or harmful",
    "If inner-child language already feels natural to you, you might call that reparenting in action",
    "do not treat it as proof of a recovered historical event"
  ]) {
    assert.equal(current.split(markerText).length - 1, 1, markerText);
    assert.equal(r4.includes(markerText), false, markerText);
  }
  assert.match(current, /Don’t dismiss your own genuine attraction, orientation, gender identity/);
  assert.doesNotMatch(current, /InnerSignal should not steer somebody toward or away from an orientation or identity/);
  assert.doesNotMatch(current, /inner-not-signal/);

  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  for (const [version, sha256] of [
    ["owner-latest-humanized-2026-10-03-r4", "1ae4140f0c6acb900ff18ef961ca2e7a136c0812678e88e64f02dc4268ca08cb"],
    ["owner-approved-continuity-scaffolding-2026-10-04-r1", "08b27742b0daa4907bbd995cc61ec3d750eb6b13d215863a70bb47f8060fbcac"],
    ["owner-approved-continuity-scaffolding-2026-10-04-r2-pre-reader-rebase", "d110de6c48c4ea725fa99edf1d25b6badfa2bf764374b794fb17b93fe646d1a5"],
    ["owner-approved-continuity-scaffolding-2026-10-04-r3-reader-facing", "f2d285911a07a8ab0b189bc53914b535db68c88dbad66a529c69b41c08f9053e"]
  ]) assert.ok(manifest.sourceHistory.some(item => item.version === version && item.sha256 === sha256));
});

test("October 4 r4 adds only the approved missing-to-love, support-mode and concentrated-support material on top of r3", async () => {
  const r3 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-04-r3.txt", import.meta.url), "utf8");
  const current = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-04-r4.txt", import.meta.url), "utf8");
  assert.equal(hash(r3), "f2d285911a07a8ab0b189bc53914b535db68c88dbad66a529c69b41c08f9053e");
  assert.equal(hash(current), "281422bbdb7833bc43ca8598bfe645b529d94c1791caafad7fbb3a988a9a897b");

  const priorLines = r3.split("\n");
  let priorIndex = 0;
  for (const line of current.split("\n")) {
    if (priorIndex < priorLines.length && line === priorLines[priorIndex]) priorIndex += 1;
  }
  assert.equal(priorIndex, priorLines.length, "r4 may add approved material but must preserve every r3 line in order");

  for (const markerText of [
    "Sometimes the ache itself can become a cue for love",
    "Sometimes one person ends up carrying many borrowed-adult functions at once",
    "Do you want me to mostly listen, help you untangle this, give you ideas, or some mix?",
    "Speak Toward What You Are Building",
    "Having somebody who can care for you when you are struggling can be an enormous blessing"
  ]) {
    assert.equal(current.split(markerText).length - 1, 1, markerText);
    assert.equal(r3.includes(markerText), false, markerText);
  }

  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  const active = manifest.sources.find(source => source.id === "inner-child-guide");
  assert.equal(active.version, "owner-approved-refractory-pain-navigation-and-care-trust-2026-10-11-r6");
  assert.equal(active.file, "inner-child-guide-2026-10-11-r6.txt");
  assert.equal(active.sha256, "e9284589535a7c8406362a13ac2d015b92fff2315a724ab660c7db2b8bf2197d");
  const r5 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-10-r5.txt", import.meta.url), "utf8");
  assert.equal(hash(r5), "96115af33451a16b0321f9fc3832d818247df042d2c29e2b68772dd815eccb31");
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-10-r5.txt" && item.sha256 === "96115af33451a16b0321f9fc3832d818247df042d2c29e2b68772dd815eccb31"));
  const successor = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-11-r6.txt", import.meta.url), "utf8");
  assert.equal(hash(successor), active.sha256);
  for (const originalLine of current.split("\n")) {
    if (originalLine.trim()) assert.ok(successor.includes(originalLine), "r5 preserves r4 wording: "+ originalLine.slice(0,60));
  }
  assert.ok(manifest.sourceHistory.some(item =>
    item.id === "inner-child-guide" &&
    item.file === "inner-child-guide-2026-10-04-r4.txt" &&
    item.sha256 === "281422bbdb7833bc43ca8598bfe645b529d94c1791caafad7fbb3a988a9a897b"
  ));
  assert.ok(manifest.sourceHistory.some(item =>
    item.id === "inner-child-guide"
    && item.version === "owner-approved-continuity-scaffolding-2026-10-04-r3-reader-facing"
    && item.sha256 === "f2d285911a07a8ab0b189bc53914b535db68c88dbad66a529c69b41c08f9053e"
  ));
});

test("current source preservation proof rejects both loss and unapproved extra wording", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r4.txt", import.meta.url), "utf8");
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text.slice(1) }));
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text + "\nUnapproved extra claim." }));
});
