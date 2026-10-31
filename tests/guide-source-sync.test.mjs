import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifySourceSync as verifyHistoricalSourceSync } from "../tasks/guide-source-sync-20260907/verify.mjs";
import { verifyOct3SourceSync } from "../tasks/inner-child-oct3-certainty-refinement-20261003/verify_source_sync.mjs";
import {
  withIssue215, withoutIssue215, QUESTION_51_R9_SHA256, CURRENT_R9_SHA256, PARENT_ANCHOR, CRITICAL_VOICE, GUARD_OLD, GUARD_NEW,
  GUARD_PHRASE, JOURNAL_ANCHOR, DRAWING_HEADING, DRAWING, NEXT_HEADING
} from "./fixtures/issue-215-guide-edits.mjs";

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
  assert.equal(active.version, "owner-approved-conflict-appraisal-addition-2026-10-31-r9");
  assert.equal(active.file, "inner-child-guide-2026-10-31-r9.txt");
  assert.equal(active.sha256, CURRENT_R9_SHA256);
  const r5 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-10-r5.txt", import.meta.url), "utf8");
  assert.equal(hash(r5), "96115af33451a16b0321f9fc3832d818247df042d2c29e2b68772dd815eccb31");
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-10-r5.txt" && item.sha256 === "96115af33451a16b0321f9fc3832d818247df042d2c29e2b68772dd815eccb31"));
  const successor = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-11-r6.txt", import.meta.url), "utf8");
  assert.equal(hash(successor), "de662515b31277737eeb3529e45758411b0b0594da8f794d5cf26ed0176ef20a");
  const currentR7 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-29-r7.txt", import.meta.url), "utf8");
  assert.equal(hash(currentR7), "1a3382826c7f1db8fcf0139f156daca0a44235337cc2a23af45ae0a25acc0adb");
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-29-r7.txt" && item.sha256 === "1a3382826c7f1db8fcf0139f156daca0a44235337cc2a23af45ae0a25acc0adb"));
  const currentR8 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-30-r8.txt", import.meta.url), "utf8");
  assert.equal(hash(currentR8), "d3237e79680b8eeeacaa14836c908cba25cb0ac84a17cf6ec1fc0bb26f73245d");
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-30-r8.txt" && item.sha256 === "d3237e79680b8eeeacaa14836c908cba25cb0ac84a17cf6ec1fc0bb26f73245d"));
  const currentR9 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-31-r9.txt", import.meta.url), "utf8");
  assert.equal(hash(currentR9), active.sha256);
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
  // r9 is the active revision now; r8 stays as it was and is registered in the manifest's source history.
  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.sourceHistory.some(item => item.id === "inner-child-guide" && item.file === "inner-child-guide-2026-10-30-r8.txt" && item.sha256 === hash(r8)));
});

test("October 31 r9 is October 30 r8 plus exactly the owner's two approved sentences (question 51, option A)", async () => {
  // The owner's answer of 31 October 2026, 12:43 UTC ("51a"): add the teaching point to the guide as written, right after the
  // question 46 sentence. The bytes below are the approved text. r8 stays immutable; r9 differs from it by this one insertion, inside
  // one existing line, and nothing else.
  const addition = `After a painful disagreement, ask what you were trying to achieve, what response you expected, and how you now feel about what you said and what followed. You can stand by your convictions and still wish you had expressed them differently; you may also accept an unavoidable consequence without regretting your choice.`;
  const anchor = `Before deciding what someone's reaction to a disagreement means, go back over what each of you actually said and did, in order.`;
  const r8 = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-30-r8.txt", import.meta.url), "utf8");
  // The three owner-approved refinements of issue 215 were made inside r9 itself; taking them out gives this revision back byte for byte.
  const r9Now = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-31-r9.txt", import.meta.url), "utf8");
  const r9 = withoutIssue215(r9Now);
  assert.equal(hash(r8), "d3237e79680b8eeeacaa14836c908cba25cb0ac84a17cf6ec1fc0bb26f73245d", "r8 is untouched");
  assert.equal(hash(r9), QUESTION_51_R9_SHA256);
  assert.equal(hash(r9Now), CURRENT_R9_SHA256);
  assert.equal(addition.length, 318);
  assert.match(addition, /^[\x20-\x7e]+$/u, "plain ASCII: no typographic quotes, no line breaks");
  assert.equal(r8.includes(addition), false, "the addition is new to r8");
  assert.equal(r8.split(anchor).length - 1, 1, "the question 46 sentence occurs once");

  // r9 is r8 with one space and the addition inserted right after the anchor sentence, and taking the insertion out gives r8 back.
  assert.equal(r9, r8.replace(anchor, () => `${anchor} ${addition}`));
  assert.equal(r9.replace(` ${addition}`, ""), r8);
  assert.equal(r9.length - r8.length, addition.length + 1);
  assert.equal(r9.split("After a painful disagreement").length - 1, 1, "the teaching point is in the guide once");

  // Exactly one line differs and none moves; the paragraph goes on as before after the insertion.
  const before = r8.split("\n");
  const after = r9.split("\n");
  assert.equal(after.length, before.length, "no line is added or removed, so no line number moves");
  assert.deepEqual(after.flatMap((line, index) => (line === before[index] ? [] : [index + 1])), [153]);
  assert.ok(after[152].startsWith(`Keep that assessment specific and revisable. ${anchor} ${addition} Someone disagreeing with you, `));

  // It sits inside the relational-reality section the graph already cites, so the section map and the nodes that cite it still resolve.
  const sourceMap = JSON.parse(await fs.readFile(new URL("../guide-graphs/source-maps/inner-child-guide.json", import.meta.url), "utf8"));
  assert.equal(sourceMap.sections.find(section => section.lineStart <= 153 && 153 <= section.lineEnd)?.id, "IC.RELATIONAL_REALITY");
  assert.equal(sourceMap.sections.length, 38, "no section is added or removed");

  // Everything that names the active revision names r9 and its hash.
  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  const layout = JSON.parse(await fs.readFile(new URL("../guides/source-layout.json", import.meta.url), "utf8"));
  const bindings = JSON.parse(await fs.readFile(new URL("../tasks/guide-fidelity-20260906/case-source-bindings-2026-09-07.json", import.meta.url), "utf8"));
  const concept = JSON.parse(await fs.readFile(new URL("../authoring/concepts/shame.json", import.meta.url), "utf8"));
  const active = manifest.sources.find(source => source.id === "inner-child-guide");
  assert.equal(active.file, "inner-child-guide-2026-10-31-r9.txt");
  assert.equal(active.sha256, hash(r9Now));
  assert.equal(layout.version, "source-layout-v15-2026-10-31");
  assert.equal(layout.textGuides.find(guide => guide.guideId === "inner-child-guide").file, active.file);
  assert.equal(bindings.sourceFile, `guides/${active.file}`);
  assert.equal(bindings.sourceSha256, active.sha256);
  assert.equal(concept.source.file, active.file);
  assert.equal(concept.source.sha256, active.sha256);
  assert.equal(manifest.sourceHistory.filter(item => item.id === "inner-child-guide").length, 16, "every earlier revision is kept in the history");
  assert.equal(sourceMap.file, active.file);
});

test("October 31 r9 also carries exactly the three owner-approved refinements of issue 215, made in place, and nothing else", async () => {
  // Issue 215 (owner approval, 31 October 2026): a critical-voice paragraph, a qualified proactive-protection example and one optional
  // anger-drawing practice. They went into r9 itself (the same revision, not an r10), so r9 now differs from its question 51 form by
  // these three edits only, and a reviewer can take them out again byte for byte.
  const r9Now = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-31-r9.txt", import.meta.url), "utf8");
  const r9Before = withoutIssue215(r9Now);
  assert.equal(hash(r9Before), QUESTION_51_R9_SHA256);
  assert.equal(hash(r9Now), CURRENT_R9_SHA256);
  assert.equal(withIssue215(r9Before), r9Now, "the three edits applied to the question 51 form give today's r9");

  // Each approved passage is in the guide exactly once and was not in the question 51 form.
  for (const [label, part] of [["critical-voice paragraph", CRITICAL_VOICE], ["qualified guard example", GUARD_NEW], ["drawing practice", DRAWING], ["drawing heading", `${DRAWING_HEADING}\n\n${DRAWING}`]]) {
    assert.equal(r9Now.split(part).length - 1, 1, `${label} appears once`);
    assert.equal(r9Before.includes(part), false, `${label} is new to the question 51 form`);
  }
  assert.equal(r9Now.includes(GUARD_OLD), false, "the unconditional inner critic is gone from the proactive-protection list");
  const occurrences = (whole, part) => whole.split(part).length - 1;
  assert.equal(occurrences(r9Now, "inner critic"), occurrences(r9Before, "inner critic") - 1, "exactly that one mention of the inner critic was replaced");

  // The edits only add lines or change the one sentence: six lines come in, none of the old lines changes except the guard line.
  const before = r9Before.split("\n");
  const after = r9Now.split("\n");
  assert.equal(after.length - before.length, 2 + 0 + 4, "a paragraph and its blank line, nothing, then a heading, a paragraph and two blank lines");
  const beforeSet = new Map();
  for (const line of before) beforeSet.set(line, (beforeSet.get(line) ?? 0) + 1);
  const added = [];
  for (const line of after) {
    const left = beforeSet.get(line) ?? 0;
    if (left > 0) beforeSet.set(line, left - 1);
    else added.push(line);
  }
  const qualifiedLine = before.find(line => line.includes(GUARD_OLD)).replace(GUARD_OLD, () => GUARD_NEW);
  assert.deepEqual(added.filter(line => line.trim() !== ""), [CRITICAL_VOICE, qualifiedLine, DRAWING_HEADING, DRAWING],
    "the only lines that are not in the question 51 form are the two approved passages, the qualified line and the approved heading");
  assert.equal(added.filter(line => line.trim() === "").length, 3, "plus the three blank lines that keep the paragraphs apart");

  // They sit in the sections they were written for, so the section map and the nodes that cite those sections still resolve.
  const sourceMap = JSON.parse(await fs.readFile(new URL("../guide-graphs/source-maps/inner-child-guide.json", import.meta.url), "utf8"));
  const lineOf = part => after.findIndex(line => line.includes(part)) + 1;
  const sectionAt = line => sourceMap.sections.find(section => section.lineStart <= line && line <= section.lineEnd)?.id;
  assert.equal(sectionAt(lineOf(CRITICAL_VOICE)), "IC.INHERITED_PARENT");
  assert.equal(sectionAt(lineOf(GUARD_PHRASE)), "IC.GUARDS");
  assert.equal(sectionAt(lineOf(DRAWING_HEADING)), "IC.HEART_SOLAR_LOOP", "the practices under Simple Practices belong to the section that precedes the next listed heading");
  assert.equal(sectionAt(lineOf(DRAWING)), "IC.HEART_SOLAR_LOOP");
  assert.equal(lineOf(CRITICAL_VOICE) < lineOf(GUARD_PHRASE) && lineOf(GUARD_PHRASE) < lineOf(DRAWING_HEADING), true);
  assert.equal(after[lineOf(CRITICAL_VOICE) - 3].endsWith(PARENT_ANCHOR), true, "directly after the paragraph that ends with the anchor sentence");
  assert.equal(after[lineOf(CRITICAL_VOICE)].trim(), "");
  assert.ok(after[lineOf(CRITICAL_VOICE) + 1].startsWith("Borrowed adulthood helps because"), "and before the paragraph that follows it");
  assert.equal(after[lineOf(DRAWING_HEADING) - 3].endsWith(JOURNAL_ANCHOR), true, "directly after Journal With Each Hand");
  assert.equal(after[lineOf(DRAWING) + 1], NEXT_HEADING, "and before the next heading");
  assert.equal(sourceMap.sections.length, 38, "no section is added or removed");
  assert.equal(sourceMap.file, "inner-child-guide-2026-10-31-r9.txt");

  // The manifest keeps the same revision label, records the new hash and says what the issue added; the history gains nothing (no r10).
  const manifest = JSON.parse(await fs.readFile(new URL("../guides/manifest.json", import.meta.url), "utf8"));
  const active = manifest.sources.find(source => source.id === "inner-child-guide");
  assert.equal(active.version, "owner-approved-conflict-appraisal-addition-2026-10-31-r9");
  assert.equal(active.file, "inner-child-guide-2026-10-31-r9.txt");
  assert.equal(active.sha256, CURRENT_R9_SHA256);
  assert.match(manifest.notes, /Inner Child refinements, filed as issue 215 on 31 October 2026 at 13:39 UTC, are made inside this same r9 file rather than a new revision/u);
  assert.equal(manifest.sourceHistory.filter(item => item.id === "inner-child-guide").length, 16);
  assert.equal(manifest.sourceHistory.some(item => /r9|r10/u.test(item.file)), false, "neither r9 nor an r10 is in the history of earlier revisions");
});

test("current source preservation proof rejects both loss and unapproved extra wording", async () => {
  const text = await fs.readFile(new URL("../guides/inner-child-guide-2026-10-03-r4.txt", import.meta.url), "utf8");
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text.slice(1) }));
  await assert.rejects(() => verifyOct3SourceSync({ candidateText: text + "\nUnapproved extra claim." }));
});
