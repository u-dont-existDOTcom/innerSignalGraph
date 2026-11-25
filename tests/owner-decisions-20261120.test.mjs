import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { loadTherapyProtocol, SERVE_INNER_CHILD_BOX_GUIDANCE, THERAPY_PROTOCOL_FILES, therapyProtocolFiles } from "../src/protocol/therapy-protocol.mjs";

// The owner's answers of 20 Nov 2026, 01:18 UTC, to questions 368 to 378 ("368a 369c 370a 371b 372b 373a 374 defaults 375
// 1a2a3c4b 376a 377 1a2a 378a"), with his Inbox notes, plus the two points his reply of 18 Nov settled. These static tests show where
// each answer is written, recorded and served; they do not show that a model follows it (see the test chats in the pull request).

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const protocol = loadTherapyProtocol();
const served = (path) => protocol.files.find((file) => file.path === path)?.content ?? "";
const skill = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md");
const allServed = [skill, ...protocol.files.map((file) => file.content)].join("\n");
const amendments = json("../guides/owner-amendments.json").items;
const amendment = (id) => amendments.find((item) => item.id === id);
const graph = (name) => json(`../guide-graphs/candidates/${name}.graph.json`);
const node = (name, id) => graph(name).nodes.find((entry) => entry.id === id);

const NEW_IDS = [
  "AMEND.IC.THREE_JOBS_WORK_TOGETHER_20261118", "AMEND.CROSS.DREAM_ONE_HINT_20261118", "AMEND.IC.SCAFFOLDING_IS_READINESS_20261120",
  "AMEND.CROSS.DREAM_NARRATIVE_FIRST_STEP_20261120", "AMEND.CROSS.PARENT_REAL_CHILD_DANGER_20261120", "AMEND.CROSS.HARM_REDUCTION_FACTS_20261120",
  "AMEND.IC.HAPPIER_FRIENDS_THEIR_CHOICE_20261120", "AMEND.IC.PROTECTIVE_NO_AGREEMENT_20261120", "AMEND.CROSS.KEEP_CAREFUL_LINES_20261120",
  "AMEND.IC.FORCED_ADULTHOOD_AND_CLAMPING_DOWN_20261120", "AMEND.IC.GENTLER_THAN_GUIDE_20261120", "AMEND.CROSS.STRICTER_THAN_GUIDE_20261120",
  "AMEND.IC.NEWER_GUIDE_PARTS_20261120", "AMEND.CROSS.AI_SIDEWAYS_AND_OWN_WORDS_20261120"
];
const OCTOBER_IDS = [
  "AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022", "AMEND.IC.LEARNED_PATTERN_FEEDBACK_AND_CRITIC_20261022", "AMEND.IC.AUTOMATIC_CARE_INTEGRATION_20261022",
  "AMEND.IC.GRATITUDE_WITHOUT_COMPARISON_20261022", "AMEND.IC.COMPASSION_WITHOUT_REQUIRED_MISERY_20261022", "AMEND.CROSS.SENSITIVE_DISCLOSURE_APP_BOUNDARY_20261022"
];

test("every answer is recorded as an owner-approved amendment, with his words", () => {
  for (const id of [...NEW_IDS, ...OCTOBER_IDS]) {
    assert.equal(amendment(id)?.status, "owner-approved", id);
    assert.equal(amendments.filter((item) => item.id === id).length, 1, `${id} once`);
  }
  assert.match(amendment("AMEND.CROSS.DREAM_NARRATIVE_FIRST_STEP_20261120").text, /let's see how they handle the dream version first/u);
  assert.match(amendment("AMEND.CROSS.HARM_REDUCTION_FACTS_20261120").text, /just point to the guides/u);
  assert.match(amendment("AMEND.IC.FORCED_ADULTHOOD_AND_CLAMPING_DOWN_20261120").text, /you can use clamping down as when you force it on yourself/u);
  assert.match(amendment("AMEND.IC.GENTLER_THAN_GUIDE_20261120").text, /open up to your inner adult and\/or a higher power if you can't open up to anyone else safely/u);
  assert.match(amendment("AMEND.CROSS.STRICTER_THAN_GUIDE_20261120").text, /too quickly validating some fleeting feeling as identity/u);
  assert.match(amendment("AMEND.CROSS.KEEP_CAREFUL_LINES_20261120").text, /fasting in chronic pain is not brought in/u);
  assert.match(amendment("AMEND.CROSS.SENSITIVE_DISCLOSURE_APP_BOUNDARY_20261022").text, /answer 369c applied/u);
  assert.equal(json("../guides/owner-amendments.json").version, "owner-amendments-2026-11-25-r25"); // IS7: the owner's 19 Oct 2026 symptom line, ported 21 Nov 2026, adds one; i79 1a (25 Nov 2026): the owner's generational line adds one
});

test("the AI guide r11 is r10 plus the live-guide passages, word for word, without the fasting passage", () => {
  const manifest = json("../guides/manifest.json");
  const source = manifest.sources.find((entry) => entry.id === "inner-child-guide");
  assert.equal(source.file, "inner-child-guide-2026-11-25-r12.txt"); // since 25 Nov 2026: r11 plus one appended section (tests/guide-generational-trauma-20261125.test.mjs)
  const r10 = read("../guides/inner-child-guide-2026-10-31-r10.txt");
  const r11 = read("../guides/inner-child-guide-2026-11-20-r11.txt");
  assert.ok(manifest.sourceHistory.some((entry) => entry.file === "inner-child-guide-2026-11-20-r11.txt" && entry.sha256 === sha256(r11)), "r11 kept in history");
  assert.ok(read(`../guides/${source.file}`).startsWith(r11), "r11 is unchanged inside r12");
  assert.ok(manifest.sourceHistory.some((entry) => entry.file === "inner-child-guide-2026-10-31-r10.txt" && entry.sha256 === sha256(r10)), "r10 kept in history");
  assert.ok(r11.startsWith(r10.replace(/\n*$/u, "")), "r10 is unchanged inside r11");
  const added = r11.slice(r10.length);
  for (const passage of [
    "You can always rephrase things as a dream narrative at first, to get the emotional content across without triggering alarm bells",
    "and you should also be content to open up to your inner adult and/or a higher power if you can’t open up to anyone else safely.",
    "Forced adulthood: You’re still stuck identifying as the lost inner child",
    "but just expect it to go sideways sometimes, and don’t let it replace real humans who love you and want to think with you.",
    "there is currently no expert consensus on how children should be disciplined, aside from using the least amount of force possible, in the least traumatizing way",
    "Look at what each of you actually said and did, and take steps to ensure your safety. Then turn inward."
  ]) assert.ok(added.includes(passage), passage);
  for (const absent of ["Compassionate Exit", "fasting", "Like MDMA, female iboga"]) assert.equal(added.includes(absent), false, absent);
  const layout = json("../guides/source-layout.json").textGuides.find((entry) => entry.guideId === "inner-child-guide");
  assert.equal(layout.file, "inner-child-guide-2026-11-25-r12.txt");
  assert.ok(layout.sections.some((section) => section.id === "IC.LIVE_GUIDE_DECISIONS_20261120"));
});

test("378a: the advice and cautions inside every box, and the cross-guide routes, are served to the chat", () => {
  assert.ok(THERAPY_PROTOCOL_FILES.includes("references/INNER-CHILD-BOX-GUIDANCE.md"));
  const boxes = served("references/INNER-CHILD-BOX-GUIDANCE.md");
  assert.equal(boxes, read("../docs/INNER-CHILD-BOX-GUIDANCE.md"), "served copy is byte-equal to the docs copy");
  assert.equal(served("references/INNER-CHILD-THERAPY-MAP.md"), read("../docs/INNER-CHILD-THERAPY-MAP.md"));
  // Since i60a (21 Nov 2026) a box's advice is read when the box is used, one section at a time, not the whole file first.
  assert.match(skill, /`references\/INNER-CHILD-BOX-GUIDANCE\.md` \(one section per box\): read the safety boxes' sections before responding \(`IC\.SAFETY_ORIENTATION`[^)]*\), and any other box's section before you use that box\./u, "the safety boxes first, the others when used");
  for (const name of ["inner-child", "cross-guide"]) {
    for (const entry of graph(name).nodes) {
      assert.ok(boxes.includes(`### ${entry.id}: `), entry.id);
      for (const line of [...entry.recommendations, ...entry.avoid]) assert.ok(boxes.includes(line.replace(/\s+/gu, " ").trim()), `${entry.id}: ${line.slice(0, 60)}`);
    }
  }
  assert.equal(graph("cross-guide").nodes.length, 24);
  const map = read("../docs/INNER-CHILD-THERAPY-MAP.md");
  for (const route of ["ROUTE.RELATIONAL_REALITY_CHECK", "ROUTE.ACT_OUTWARD", "ROUTE.GRATITUDE_PRACTICE"]) assert.match(map, new RegExp(`"${route.replace(".", "\\.")}<br/>[A-Z]`, "u"), `${route} has a name in the map`);
});

test("378a: the six October changes are redone, with 369c replacing the October disclosure line", () => {
  assert.match(served("references/INNER-CHILD-BOX-GUIDANCE.md"), /Distinguish a learned defensive guard from the chosen Adult Protector role/u);
  assert.match(served("references/PROTOCOL-STATE-PROVENANCE.md"), /INNER-CHILD CONCEPT ALIGNMENT \(owner, 22 October 2026; redone 20 November 2026\)/u);
  assert.equal(allServed.includes("Do not coach disguising"), false);
  assert.equal(allServed.includes("Do not advise presenting actual safety-relevant conduct as a dream"), false);
});

test("settled points, 368a, 369c and 377: SKILL.md and the shame rules", () => {
  assert.match(skill, /Safety \(the Protector\) usually comes first, then love, then guidance, but no job works alone, so never hold love or guidance back until safety is "done"; the map's step order stays\./u);
  assert.match(skill, /Scaffolding is the readiness check: start with the smallest step that feels possible, and go deeper only after the last one went well\. Coming back to the room is practised on those small steps, never tested before starting\./u);
  const shame = served("references/PHENOMENOLOGY-AND-REPRESENTATION.md");
  assert.match(shame, /a dream can be true, and like a feeling it is one hint among others, to check against real life/u);
  assert.match(shame, /tell it as a dream narrative to get the emotional content across/u);
  assert.match(shame, /Do not suggest asking a therapist what they must report or write down/u);
  assert.equal(allServed.includes("asked first, in general terms, what the therapist must report"), false);
  assert.match(shame, /InnerSignal is an AI that can go sideways at times, so it is best used alongside people who love them/u);
  assert.match(skill, /offer it as a draft for them to put in their own words, not as ready-to-send text/u);
  assert.equal(skill.includes("one complete merged ready-to-send reply"), false);
});

test("370a and 371b: a parent's real child, and someone about to take something", () => {
  const parent = skill.slice(skill.indexOf("## A parent asking about a real child"), skill.indexOf("## Chronic pain"));
  const order = ["everyone physically safe", "the parent's own calm", "as his experience and not as a method"].map((part) => parent.indexOf(part));
  assert.ok(order.every((at) => at > 0) && order[0] < order[1] && order[1] < order[2], "safety, calm, then his experience");
  assert.match(parent, /Never instruct holding a child until they cry, or locking a child in\./u);
  assert.match(skill, /give plain harm-reduction facts/u);
  assert.match(skill, /Never urge anyone to take anything\./u);
  const referrals = served("references/GUIDE-REFERRALS.md");
  for (const link of ["https://shame.u-dont-exist.com", "https://romance.u-dont-exist.com", "https://lucid.u-dont-exist.com", "https://bufo.u-dont-exist.com"]) assert.ok(referrals.includes(link), link);
  assert.equal(allServed.includes("more protective and nurturing than many other medicines"), false, "no named list of gentler medicines");
  assert.match(skill, /Never import experimental rescue substances or dosing from the public bad-trips guide as executable emergency treatment\./u);
});

test("372b, 373a, 374, 375 and 376a reach the boxes", () => {
  assert.match(node("inner-child", "IC.MEET_GUARD").avoid.join(" "), /neither obeyed nor overridden automatically: hear the part out and look for an agreement every part can accept/u);
  assert.match(node("inner-child", "IC.DIFFERENTIATION").recommendations.join(" "), /"misery loves company", that is their choice, and being happy is ultimately more helpful for everyone/u);
  assert.match(served("references/RESPONSE-FIDELITY.md"), /the opposite trap is clamping down, forcing strict discipline on oneself/u);
  assert.equal(allServed.includes("opposite trap is forced adulthood"), false);
  assert.match(skill, /1\. forced adulthood: still identifying as the lost inner child/u);
  assert.match(node("inner-child", "IC.DEEP_LOVE_TO_CHILD").recommendations.join(" "), /Offer it as a possibility, never as blame\./u);
  assert.match(node("inner-child", "IC.SHAME_APPRAISAL").recommendations.join(" "), /inner adult and\/or a higher power counts too/u);
  assert.match(node("cross-guide", "ROUTE.INFLUENCE_INTERNAL").recommendations.join(" "), /Neither validate a passing feeling as identity nor wave a real attraction, orientation or gender identity away/u);
  assert.match(node("inner-child", "IC.WISER_SELF_PERSPECTIVE").recommendations.join(" "), /that hindsight cast first, a memory they can handle for the first tries, then small steps/u);
  const forgiveness = node("inner-child", "IC.FORGIVENESS_LATER");
  assert.equal(forgiveness.title, "Forgiveness as the Nurturer's work on resentment, never on a schedule");
  assert.equal(JSON.stringify(forgiveness.activation).includes("deep_work_readiness"), false);
  assert.match(node("inner-child", "IC.INTUITION_TRUST_CALIBRATION").recommendations.join(" "), /D\.A\.R\.V\.O\./u);
  assert.match(node("cross-guide", "ROUTE.REFRACTORY_PAIN_NAVIGATION").avoid.join(" "), /"the pain isn't real"/u);
  assert.match(served("references/PROTECTIVE-COMPATIBILITY.md"), /their little one stays out of it/u);
});

// Fix round after Fable's check of the build (20 Nov 2026): his must-change items 1, 2, 3 and 5, and from his decision list
// a served line for 374 1a and the AI disclosure (377 1a) kept from opening a reply.
test("fix round: 375 4b, 373, 372 item 8, no bookkeeping, 374 1a and 377 1a as served", () => {
  const boxes = served("references/INNER-CHILD-BOX-GUIDANCE.md");
  assert.equal(allServed.includes("was planted"), false, "the 4c clause he passed over is not served");
  assert.match(boxes, /Do not quickly validate a fleeting feeling as identity, and do not rule for the person whether a feeling is authentically theirs or pressed on them; the person sorts that over time\./u);
  assert.equal(allServed.includes("always means stage 1"), false, "both are forced adulthood (his note)");
  assert.match(skill, /Forced adulthood is stage 1; when a person forces it on themselves \(strict discipline, no visible needs, little joy\) call it "clamping down", the opposite trap to spoiling\./u);
  assert.match(boxes, /when a person forces it on themselves \(strict discipline, no visible needs, little joy\), call it "clamping down", the opposite trap to spoiling/u);
  assert.match(served("references/RESPONSE-FIDELITY.md"), /clamping down, forcing strict discipline on oneself \(perfect discipline, no visible needs, very little joy or closeness\): forced adulthood one forces on oneself, where/u);
  assert.equal(allServed.includes("acknowledge a possible real loss"), false, "the half of item 8 he replaced");
  assert.match(boxes, /Do not promise that everyone will welcome their growth; assess what has actually happened\./u);
  assert.equal(/owner answer 369c/iu.test(allServed), false, "no bookkeeping inside chat instructions");
  assert.match(served("references/PROTOCOL-STATE-PROVENANCE.md"), /After a decline, care, protection and guidance continue in the person's own words with no reparenting label\. If the person wonders whether the no comes from a protective part, explore that with them\./u);
  for (const text of [skill, served("references/PHENOMENOLOGY-AND-REPRESENTATION.md"), boxes]) {
    assert.match(text, /not as an opening warning \(not at the top of a reply or announced as "one thing up front": weave it in after answering what the person brought\)/u);
  }
});

test("the cheaper option, prepared and not chosen: the protective-part rule in SKILL.md, and the box guidance one switch", () => {
  assert.equal(SERVE_INNER_CHILD_BOX_GUIDANCE, true, "default as answered (378a): served");
  assert.match(skill, /A protective part's no to going deeper, to an altered state or to sex is neither obeyed nor overridden automatically: hear the part out and look for an agreement every part can accept\./u);
  assert.match(skill, /\(the owner's example: a part that told him not to talk to strangers\); it is not one size fits all\. InnerSignal never pushes an override, including through prediction-testing: the person decides\./u);
  const off = loadTherapyProtocol({ boxGuidance: false });
  const without = THERAPY_PROTOCOL_FILES.filter((file) => file !== "references/INNER-CHILD-BOX-GUIDANCE.md");
  assert.deepEqual([...therapyProtocolFiles({ boxGuidance: false })], without);
  assert.deepEqual(off.files.map((file) => file.path), without);
  assert.notEqual(off.protocolSha256, protocol.protocolSha256);
  assert.equal([off.instructions, ...off.files.map((file) => file.content)].some((text) => text.includes("INNER-CHILD-BOX-GUIDANCE")), false,
    "nothing served points to the file that is not served");
  assert.match(off.instructions, /^Read `references\/PROTECTIVE-COMPATIBILITY\.md`, `references\/INNER-CHILD-THERAPY-MAP\.md`, `references\/PHENOMENOLOGY-AND-REPRESENTATION\.md`, /mu);
  assert.match(off.instructions, /^Use the boxes that fit this person and this moment, not all of them as a checklist\.$/mu);
  assert.match(off.instructions, /A protective part's no to going deeper, to an altered state or to sex is neither obeyed nor overridden automatically/u);
  const map = (loaded) => loaded.files.find((file) => file.path === "references/INNER-CHILD-THERAPY-MAP.md").content;
  assert.match(map(off), /^The 3 cross-guide routes that these arrows reach are named in their own group\.$/mu);
  for (const file of off.files.filter((entry) => entry.path !== "references/INNER-CHILD-THERAPY-MAP.md")) {
    assert.equal(file.content, served(file.path), `${file.path} is served byte for byte in both settings`);
  }
  assert.equal(map(off), map(protocol).replace(" What is inside every box, and all the cross-guide routes, is in the box guidance file (INNER-CHILD-BOX-GUIDANCE.md).", ""));
});
