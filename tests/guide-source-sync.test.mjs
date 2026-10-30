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
  assert.equal(active.version, "owner-approved-disclosure-additions-2026-10-30-r8");
  assert.equal(active.file, "inner-child-guide-2026-10-30-r8.txt");
  assert.equal(active.sha256, "d3237e79680b8eeeacaa14836c908cba25cb0ac84a17cf6ec1fc0bb26f73245d");
  const r5 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-10-r5.txt", import.meta.url), "utf8");
  assert.equal(hash(r5), "96115af33451a16b0321f9fc3832d818247df042d2c29e2b68772dd815eccb31");
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-10-r5.txt" && item.sha256 === "96115af33451a16b0321f9fc3832d818247df042d2c29e2b68772dd815eccb31"));
  const successor = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-11-r6.txt", import.meta.url), "utf8");
  assert.equal(hash(successor), "de662515b31277737eeb3529e45758411b0b0594da8f794d5cf26ed0176ef20a");
  const currentR7 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-29-r7.txt", import.meta.url), "utf8");
  assert.equal(hash(currentR7), "1a3382826c7f1db8fcf0139f156daca0a44235337cc2a23af45ae0a25acc0adb");
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-29-r7.txt" && item.sha256 === "1a3382826c7f1db8fcf0139f156daca0a44235337cc2a23af45ae0a25acc0adb"));
  const currentR8 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-30-r8.txt", import.meta.url), "utf8");
  assert.equal(hash(currentR8), active.sha256);
  for (const originalLine of current.split("\n")) {
    if (originalLine.trim()) assert.ok(successor.includes(originalLine), "r6 preserves r4 wording: "+ originalLine.slice(0,60));
  }
  for (const originalLine of successor.split("\n")) {
    if (originalLine.trim()) assert.ok(currentR7.includes(originalLine), "r7 preserves r6 wording: "+ originalLine.slice(0,60));
  }
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-11-r6.txt" && item.sha256 === "de662515b31277737eeb3529e45758411b0b0594da8f794d5cf26ed0176ef20a"));
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

test("October 30 r8 is October 29 r7 plus exactly the owner's two approved additions (question 46, option A)", async () => {
  // The owner's answer of 30 October 2026, 22:03 UTC ("56a", read as "46: A"): add both additions as written. The bytes below are the
  // approved text. r7 stays immutable; r8 differs from it by these two insertions, each after one existing sentence, and nothing else.
  const additionOne = `If there's something you've never told anyone and you do want one person to know, choose them by how easily they handle difficult subjects, not by how close they are. Start with the general kind of thing, such as "it's about something sexual" or "it's about my childhood", ask whether they're open to hearing more, and see how a smaller truth is received before you give details; if they seem alarmed, you can slow down or stop. With a therapist, it's fine to ask first, in general terms, what they would have to report or write down. If you feel or suspect that something sexual and harmful happened to you early in life, a therapist experienced with early sexual trauma can help, and you don't need to be sure what happened to look for one. If you came across illegal material by accident, seeing it isn't the same as seeking it: don't save or share it, report it to the platform if you wish, and ask a lawyer if you're worried about the law. An AI helper can help you think these things through, but some topics are beyond it; a good one tells you so plainly and points you to a person who can help.`;
  const additionTwo = `Before deciding what someone's reaction to a disagreement means, go back over what each of you actually said and did, in order.`;
  const afterDisclosure = "Choose disclosure according to trust, purpose and consequences.";
  const afterAssessment = "Keep that assessment specific and revisable.";
  const r7 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-29-r7.txt", import.meta.url), "utf8");
  const r8 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-30-r8.txt", import.meta.url), "utf8");
  assert.equal(hash(r7), "1a3382826c7f1db8fcf0139f156daca0a44235337cc2a23af45ae0a25acc0adb", "r7 is untouched");
  assert.equal(hash(r8), "d3237e79680b8eeeacaa14836c908cba25cb0ac84a17cf6ec1fc0bb26f73245d");
  assert.equal(additionOne.length, 1102);
  assert.equal(additionTwo.length, 127);
  for (const addition of [additionOne, additionTwo]) {
    assert.match(addition, /^[\x20-\x7e]+$/u, "plain ASCII: no typographic quotes, no line breaks");
    assert.equal(r7.includes(addition), false, "the additions are new to r7");
  }
  for (const anchor of [afterDisclosure, afterAssessment]) assert.equal(r7.split(anchor).length - 1, 1, anchor);

  // r8 is r7 with one space and each addition inserted right after its anchor sentence, and taking the two insertions out gives r7 back.
  const built = r7
    .replace(afterAssessment, () => `${afterAssessment} ${additionTwo}`)
    .replace(afterDisclosure, () => `${afterDisclosure} ${additionOne}`);
  assert.equal(r8, built);
  assert.equal(r8.replace(` ${additionOne}`, "").replace(` ${additionTwo}`, ""), r7);
  assert.equal(r8.length - r7.length, additionOne.length + additionTwo.length + 2);

  // Line by line, exactly two lines differ. The paragraphs continue as before after each insertion.
  const before = r7.split("\n");
  const after = r8.split("\n");
  assert.equal(after.length, before.length, "no line is added or removed, so no line number moves");
  const changed = after.flatMap((line, index) => (line === before[index] ? [] : [index + 1]));
  assert.deepEqual(changed, [153, 189]);
  assert.ok(after[152].startsWith(`${afterAssessment} ${additionTwo} Someone disagreeing with you, `));
  assert.ok(after[188].includes(`${afterDisclosure} ${additionOne} If another disclosure is really a repeated test of worth or certainty, `));

  // Each insertion sits inside the section it was written for, so the section map and the graph nodes that cite those sections still resolve.
  const sections = JSON.parse(await fs.readFile(new URL("../guide-graphs/source-maps/inner-child-guide.json", import.meta.url), "utf8")).sections;
  const sectionOf = line => sections.find(section => section.lineStart <= line && line <= section.lineEnd)?.id;
  assert.equal(sectionOf(153), "IC.RELATIONAL_REALITY");
  assert.equal(sectionOf(189), "IC.SHAME_APPRAISAL");
  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  const layout = JSON.parse(await fs.readFile(new URL("../guides/source-layout.json", import.meta.url), "utf8"));
  assert.equal(layout.textGuides.find(guide => guide.guideId === "inner-child-guide").file, manifest.sources.find(source => source.id === "inner-child-guide").file);
  assert.equal(manifest.sources.find(source => source.id === "inner-child-guide").file, "inner-child-guide-2026-10-30-r8.txt");
});

test("current source preservation proof rejects both loss and unapproved extra wording", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r4.txt", import.meta.url), "utf8");
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text.slice(1) }));
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text + "\nUnapproved extra claim." }));
});
