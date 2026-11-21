import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";

// The crisis rules folded in from the inner-child lane's t135 handoff (owner, 20 Nov 2026 23:25 UTC), with his answers 387a and
// 388b, and his answer to point 16 on the two kinds of guard (Inbox, 20 Nov 2026 22:27 UTC). The design, both red teams and the
// test conversations are in docs/superpowers/specs/2026-11-21-crisis-rules-and-guards-design.md. These static tests show where the
// lines are written, compiled and served; they do not show that a model follows them.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const SKILL = "../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md";
const BOXES = "../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-BOX-GUIDANCE.md";
const HEADING = "## When someone may want to die\n";
const NEXT = "## A parent asking about a real child who is being dangerous now\n";
const AMEND = "AMEND.IC.GUARDS_USUALLY_A_MIX_20261120";

const section = () => {
  const skill = read(SKILL);
  return skill.slice(skill.indexOf(HEADING), skill.indexOf(NEXT));
};

test("the crisis section is written once in SKILL.md, before the parent section, and is served to chats", () => {
  const skill = read(SKILL);
  assert.equal(count(skill, HEADING), 1);
  assert.ok(skill.indexOf(HEADING) < skill.indexOf(NEXT), "it comes before the parent's real-child section");
  const served = loadTherapyProtocol({ boxGuidance: true }).instructions;
  assert.ok(served.includes("When someone may want to die"), "the served instructions carry it");
  assert.ok(served.includes("Never, once someone in this conversation has said they want to die or might act"));
});

test("three levels: acted or about to, wants to die, and thoughts with no wish to act or with pain (D1)", () => {
  const text = section();
  assert.match(text, /Don't infer a wish to die from sadness, self-hatred, grief, an idiom/u);
  assert.match(text, /a stored record, or something said in an earlier conversation/u);
  assert.match(text, /They have acted or are about to/u);
  assert.match(text, /Thoughts of death with no wish to act, or that come with physical pain and no intent/u);
  assert.match(text, /no phone numbers, no safety questions and no plan for tonight/u);
  assert.match(text, /one plain question inside your answer is enough, asked once/u);
  assert.match(text, /Self-harm without a wish to die is met as pain to understand/u);
});

test("the first step: the emergency number at once, poison help never instead, no number it isn't sure of", () => {
  const text = section();
  for (const number of ["112", "911", "999"]) assert.ok(text.includes(number), number);
  assert.match(text, /A poison centre can be named as well when they're awake and talking, never instead/u);
  assert.match(text, /Never give a number you aren't sure of/u);
  assert.match(text, /Feeling fine doesn't mean it's safe/u);
  assert.match(text, /never tell them to wait and see, sleep it off or make themselves sick/u);
  assert.match(text, /that stays the one subject/u);
  assert.match(text, /You can't call anyone or send anyone/u);
  // After a Claude test run offered a poison centre in place of the emergency number once an ambulance was refused (21 Nov 2026):
  // a refusal keeps the number as the advice, written once, in the first step, after its next-smallest-thing sentence.
  const step = section();
  const firstStep = step.slice(step.indexOf("**The first step.**"), step.indexOf("**The replies.**"));
  const refusal = "If they say no to an ambulance or to calling, the emergency number stays the advice: never offer anything as the way " +
    "around it (a poison centre, or for someone about to act a crisis line, may be named beside it, never in its place; not " +
    "a doctor tomorrow, not waiting to see). If they haven't said why, ask once what makes them say no, without arguing or " +
    "promising how any service will respond, and keep trying the next smallest thing toward help, which includes someone " +
    "else making the call and, if the number can't be reached or no ambulance can come, someone taking them to emergency " +
    "care now (never driving themselves). If they've taken something, the reason you give stays that you can't know what it " +
    "will do and some medicines do their harm hours later; whatever they've done, never say what it could do to their body.";
  assert.ok(step.indexOf("**The first step.**") > 0 && firstStep.length > 0, "the first step is found");
  assert.ok(firstStep.indexOf(refusal) > firstStep.indexOf("keeping the packets for the paramedics)."), "the refusal sentence is in the first step, after the next smallest thing");
  assert.ok(firstStep.indexOf("keeping the packets for the paramedics).") > 0);
  assert.equal(count(loadTherapyProtocol({ boxGuidance: true }).instructions, refusal), 1, "and served once");
});

test("387a and 388b: the people to reach are in the first reply, never as its opening line, with their links", () => {
  const text = section();
  assert.match(text, /In this order, it says that you heard what they want to end/u);
  assert.match(text, /in the sentence where you suggest reaching someone, names all four people they could reach, today or in the next days, as choices with their links/u);
  assert.match(text, /the owner's Hearthwork guide, https:\/\/hearthwork\.u-dont-exist\.com, shows a free way for two people to listen to each other; it isn't a service to call/u);
  assert.match(text, /It isn't a hotline script, it isn't repeated in later replies, and it never goes to the third level above/u);
  assert.match(text, /don't argue with it or say you can't confirm it; join what you can honestly share in it/u);
  // The three links are found as whole links in the text (a set of the links it contains), not as substrings.
  const links = new Set([...text.matchAll(/https?:\/\/[^\s),;"]+/gu)].map((match) => match[0]));
  for (const link of ["https://hearthwork.u-dont-exist.com", "https://ibogaqueen.substack.com/i/189761959/finding-a-therapist",
    "https://findahelpline.com"]) assert.ok(links.has(link), link);
  assert.match(text, /or a crisis line, where even a stranger can help/u);
});

test("the boundary: no fasting, no detox, no other guide links and nothing about how to die, kept for the whole conversation", () => {
  const text = section();
  const never = text.slice(text.indexOf("**Never, once someone in this conversation"), text.indexOf("**Fasting otherwise.**"));
  assert.match(never, /even if they ask, bring it up themselves or give another reason later/u);
  assert.match(never, /how to fast or go without food or drink, for any purpose/u);
  assert.match(never, /the word "detox"/u);
  assert.match(never, /anything about how to die \(methods, amounts, how long it takes, what happens to the body without food or water, what's painless\)/u);
  assert.match(never, /This holds in any reply you draft or edit for someone else to send/u);
  // The only links before the fasting paragraph are the three people-to-reach links; the guide's suicide, pain, Compassionate Exit
  // and detox sections are never linked in a crisis.
  const crisisPart = text.slice(0, text.indexOf("**Fasting otherwise.**"));
  const links = [...crisisPart.matchAll(/https?:\/\/[^\s),;]+/gu)].map((match) => match[0]);
  assert.deepEqual([...new Set(links)].sort(), ["https://findahelpline.com", "https://hearthwork.u-dont-exist.com",
    "https://ibogaqueen.substack.com/i/189761959/finding-a-therapist"]);
  assert.doesNotMatch(read(SKILL), /compassionate-exit|if-you-want-to-kill-yourself|physical-pain/u);
});

test("the harm-reduction facts give no amounts to someone who may be taking something to die", () => {
  assert.match(read(SKILL), /This is for taking something for its effects\. If they may be taking it to die or to hurt themselves, or have said in this conversation that they want to die, give no amounts or doses for anything/u);
  assert.match(read(SKILL), /the only guide links are the ones the section on that names/u);
  // The owner's reply on 388 (Inbox, 20 Nov 2026 23:45 UTC): therapy questions InnerSignal can't answer, suggestions and praise go to a
  // comment on his guide, where he answers. His direct contact as a last resort is his Signal username (391a, the next test).
  assert.match(read(SKILL), /they can leave a comment on the owner's guide \(https:\/\/innerchild\.u-dont-exist\.com, or the guide the question is about\), and he answers there/u);
  assert.doesNotMatch(read(SKILL), /whatsapp|\+\d{6,}/iu, "no personal contact detail is in the served rules");
});

test("the owner's Signal username is the last resort in step 2, after the other options, and never a promise (391a)", () => {
  // The owner's answer 391a (chat, 21 Nov 2026): the last-resort contact is his Signal username, which is public and which he can
  // retire, never his phone number.
  const text = section();
  const stepTwo = text.indexOf("\n2. One person:");
  const stepThree = text.indexOf("\n3. The body");
  assert.ok(stepTwo > 0 && stepThree > stepTwo, "step 2 is found");
  const step = text.slice(stepTwo, stepThree);
  // The whole sentence, so the username and the caveat stay attached to the condition, inside step 2 and after the options for
  // someone who has no one.
  const lastResort = "If they've tried those and none is there for them right now (for example, the crisis line didn't help), they can " +
    "message the owner, who wrote the guide InnerSignal is built on, on Signal, where his username is udontexist.42 (in Signal, start a " +
    "new chat and find him by username). Say plainly that he can't talk with everyone and may not be free, so it's a chance, not a " +
    "promise, and keep the other steps going.";
  const noOne = step.indexOf("If there's no one, believe them and don't list people again");
  assert.ok(noOne > 0 && step.indexOf(lastResort) > noOne, "the sentence comes in step 2, after the options for someone who has no one");
  const served = loadTherapyProtocol({ boxGuidance: true }).instructions;
  assert.equal(count(served, lastResort), 1, "the sentence is served once");
  assert.equal(count(served, "udontexist.42"), 1, "the username is served only in that sentence");
  assert.doesNotMatch(served, /whatsapp/iu);
  // No phone number: no long run of digits in SKILL.md once the therapist list's link (whose post id is a long number) is set aside
  // as a whole link; digits inside any other link still count.
  const therapistList = "https://ibogaqueen.substack.com/i/189761959/finding-a-therapist";
  const scanned = read(SKILL).replace(/https?:\/\/[^\s),;"]+/gu, (link) => (link === therapistList ? " " : link));
  assert.doesNotMatch(scanned, /\+?\d[\d ().-]{5,}\d/u, "no phone number in SKILL.md");
});

test("the owner's answer on guards is an owner-approved amendment in his words, written once in each of the two boxes, compiled and served", () => {
  const amendments = json("../guides/owner-amendments.json");
  const item = amendments.items.find((entry) => entry.id === AMEND);
  assert.equal(item?.status, "owner-approved");
  assert.match(item.text, /both types of guards should be considered as possibly helpful, possibly unhelpful, and usuallly a mix of both/u);
  assert.match(item.text, /fully reprogram them like if it's a totally useless old script/u);
  assert.match(item.text, /Mr\. Rogers reframing trick to stay curious about the critical voice's motivations/u);
  const graph = json("../guide-graphs/candidates/inner-child.graph.json");
  const guard = graph.nodes.find((node) => node.id === "IC.MEET_GUARD");
  const kernel = graph.nodes.find((node) => node.id === "IC.CRITICISM_KERNEL");
  for (const node of [guard, kernel]) assert.ok(node.sourceRefs.includes(AMEND), node.id);
  const guardLine = guard.recommendations.at(-1);
  const kernelLine = kernel.recommendations.at(-1);
  assert.match(guardLine, /^Any guard, whether it stays on duty or jumps in when pain gets close/u);
  assert.match(guardLine, /usually, a mix\. Don't decide which in advance/u);
  assert.match(guardLine, /this is never required before they reject an insult, set a limit or take relief/u);
  assert.match(guardLine, /Whether a part is that is the person's call/u);
  assert.match(guardLine, /For a part's no to going deeper, to an altered state or to touch or sex, the override rule decides, not this one/u);
  assert.match(kernelLine, /^Like a guard, an inner critic may be helpful, unhelpful or, usually, a mix/u);
  const bundle = json("../guide-graphs/compiled/bundle.json");
  const compiled = bundle.graphs.flatMap((graph) => graph.nodes);
  for (const [id, line] of [["IC.MEET_GUARD", guardLine], ["IC.CRITICISM_KERNEL", kernelLine]]) {
    assert.deepEqual(compiled.filter((node) => JSON.stringify(node).includes(line)).map((node) => node.id), [id]);
    assert.equal(count(read(BOXES), line), 1, `${id}'s line is served once`);
  }
  assert.match(read(SKILL), /Guards and critical voices alike may be helpful, unhelpful or, usually, a mix/u);
  assert.equal(amendments.version, "owner-amendments-2026-11-20-r23");
});
