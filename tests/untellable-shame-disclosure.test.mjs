import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { untellableShameRules } from "../src/prompts/untellable-shame.mjs";
import { responseFidelityRules } from "../src/prompts/response-fidelity.mjs";
import { longitudinalClinicalRules, sharedClinicalRules } from "../src/prompts/common.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol, unservedReferenceMentions } from "../src/protocol/therapy-protocol.mjs";

// Owner request of 26 October 2026: shame about what a person believes they can't tell anyone, graded disclosure, the AI
// saying what it can't help with, a therapist experienced with early sexual trauma, accidental exposure, and outside review
// only on evidence of current risk. Every example is synthetic. These static tests show where the rules are written, served
// and bound; they do not show that a model follows them.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const AMENDMENT = "AMEND.CROSS.UNTELLABLE_SHAME_AND_DISCLOSURE_20261028";
const PHENOMENOLOGY = "references/PHENOMENOLOGY-AND-REPRESENTATION.md";
const FAILURES = [
  "DISCLOSURE_MET_WITH_ALARM",
  "MATERIAL_KIND_BLURRED",
  "DISCLOSURE_PRESSED_OR_UNGRADED",
  "LIMIT_UNNAMED_OR_AS_VERDICT",
  "EARLY_HARM_OPTION_MISHANDLED",
  "ACCIDENTAL_EXPOSURE_MISFRAMED",
  "CURRENT_DANGER_CONCEALED",
  "TABOO_MATERIAL_OUTSIDE_REVIEW"
];
// The owner's own sentences, kept whole, and the clauses of the two additions.
const OWNER_CLAUSES = [
  "Shame often guards something the person believes they can't tell anyone: a feeling, desire, fantasy, attraction, dream, memory or act they expect would bring rejection or alarm.",
  "Keeping it secret keeps the self-rejection going; being understood without flinching loosens it.",
  "Assume this may be there whenever shame is strong, journal or no journal.",
  "Name what it is (feeling, fantasy, dream, uncertain memory, accidental exposure, chosen act), keep it apart from the person's worth and from intent, and never answer with alarm, moralizing or a refusal script.",
  "Help the person choose whom to tell and how much: a therapist they feel safe with, asked first, in general terms, what they must report or write down; a friend who has shown ease with taboo subjects.",
  "Start with the general kind of thing, ask before giving details, see how a smaller truth is received, and slow down or stop if the listener seems alarmed.",
  "When the AI can't take a topic on, say so as soon as it matters: what it can't help with, that this is a limit of the tool and not a verdict on the person, and where a human can help.",
  "say once, in plain words and without alarm, that some topics may reach the limits of what the AI can help with and that if one does it will say so and point to a person who can help.",
  "Never present this as a warning about the person",
  "offer, as an option, a therapist experienced with early sexual trauma, without asserting that abuse happened.",
  "Accidentally seeing illegal material isn't seeking it",
  "to not save or share the material, to report it if they wish, and to ask a lawyer about anything legal.",
  "Send journal or conversation material for outside review only when there's evidence of current risk to someone, never for taboo content, dreams, fantasies or a past accidental exposure."
];

function rolePrompts() {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
    recentTranscript: "synthetic", userMessage: "synthetic" };
  const packet = { recent_transcript: "synthetic", current_user_message: "synthetic" };
  return [
    ["case audit", caseAuditPrompt(context, {})],
    ["candidate", candidatePrompt(context, "synthetic")],
    ["critique", critiquePrompt(context, {}, "synthetic", "synthetic")],
    ["adjudication", adjudicationPrompt(context, {}, "synthetic")],
    ["realization", realizationPrompt(context, {}, "synthetic")],
    ["private audit", privateRuntimeAuditPrompt(packet)],
    ["private repair", privateRuntimeRepairPrompt(packet)]
  ];
}

test("the rule is written once, carries the owner's sentences and both additions, and names its audit failures", () => {
  for (const clause of OWNER_CLAUSES) assert.ok(untellableShameRules.includes(clause), clause);
  assert.match(untellableShameRules, /^\nUNTELLABLE SHAME AND GRADED DISCLOSURE \(untellable-shame-v1\)\n- Shame often guards/u);
  assert.match(untellableShameRules, /\n\nUNTELLABLE SHAME AUDIT FAILURES\n- DISCLOSURE_MET_WITH_ALARM: /u);
  assert.ok(untellableShameRules.endsWith("without evidence of current risk to someone.\n"));
  for (const code of FAILURES) {
    assert.equal(count(untellableShameRules, `\n- ${code}: `), 1, code);
    assert.equal(responseFidelityRules.includes(code), false, `${code} is new, not a renamed response-fidelity code`);
  }
  assert.equal(untellableShameRules.split("\n").filter((line) => /^- [A-Z_]+: /u.test(line)).length, FAILURES.length);
  assert.deepEqual(unservedReferenceMentions(untellableShameRules), []);
});

test("the rules agree with the rules already in force: no concealment of danger, no abuse asserted, no preventive referral", () => {
  // Naming a thing apart from intent does not suspend the separate question of reported intent or planning.
  assert.match(untellableShameRules, /does not suspend the separate question of reported current intent, planning or conduct that endangers someone/u);
  assert.match(untellableShameRules, /None of this extends to helping hide current danger to the person or to someone else, which comes first\./u);
  assert.match(untellableShameRules, /A chosen act is still named as chosen, with responsibility and the protection of anyone affected in view; naming it neither excuses it nor condemns the person\./u);
  // The early-sexual-harm option stays inside the felt-violation rule and the 26 Oct feeling-and-agency amendment.
  assert.match(untellableShameRules, /The trigger is the person's own report of feeling or suspecting it, not the AI's inference from a fantasy, dream or image\./u);
  assert.match(untellableShameRules, /neither confirmed nor denied, no perpetrator named, no memory reconstruction steered/u);
  assert.match(untellableShameRules, /not a preventive, reporting or institutional referral/u);
  assert.match(responseFidelityRules, /A felt violation or fear can be supported and explored without identifying a perpetrator or asserting recovered abuse/u);
  assert.match(responseFidelityRules, /Do not automatically route shame about feelings alone to an institutional prevention service/u);
  assert.match(responseFidelityRules, /In a dream, vision, or intoxicated account, words attributed to another person remain words experienced in that state/u);
  // The existing instruction not to help conceal current suicidal intent or imminent danger is unchanged.
  const skill = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md");
  assert.match(skill, /Do not encourage concealment or false denial of current suicidal intent, a plan, inability to stay safe or imminent danger\./u);
  // The AI keeps its own limits on what it writes; understanding does not need explicit detail.
  assert.match(untellableShameRules, /Understanding the material does not require explicit detail, and the AI need not write or elaborate any\./u);
});

test("the served phenomenology reference mirrors the module and no other served file carries it", () => {
  const protocol = loadTherapyProtocol();
  assert.equal(THERAPY_PROTOCOL_FILES.length, 9, "no served file was added");
  const served = protocol.files.find((file) => file.path === PHENOMENOLOGY);
  assert.ok(served?.content.endsWith(untellableShameRules), "the served reference ends with the module text, byte for byte");
  assert.match(served.content, /\n## Untellable shame and graded disclosure\n\nOwner request, 26 October 2026\. Shared semantic rules; not proof of model adherence\.\n\nUNTELLABLE SHAME AND GRADED DISCLOSURE/u);
  for (const clause of OWNER_CLAUSES) assert.ok(served.content.includes(clause), clause);
  for (const file of protocol.files) {
    if (file.path === PHENOMENOLOGY) continue;
    assert.equal(file.content.includes("UNTELLABLE SHAME"), false, `${file.path} does not carry the rule`);
  }
  // Not in the response-fidelity reference, module or critique prompt, which another change is editing.
  for (const path of ["../src/prompts/response-fidelity.mjs", "../src/prompts/critique.mjs",
    "../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md"]) {
    assert.doesNotMatch(read(path), /untellable/iu, path);
  }
});

test("the skill sends the model to the rules, and the protocol still loads", () => {
  const skill = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md");
  const readLine = skill.split("\n").find((line) => line.startsWith("Read `references/") && line.endsWith("before responding."));
  assert.ok(readLine.includes(`\`${PHENOMENOLOGY}\``), "the phenomenology reference is read before every response");
  const pointer = skill.split("\n").find((line) => line.startsWith("When shame is strong, or the person approaches something they believe they can't tell anyone"));
  assert.ok(pointer, "the skill points to the rules");
  for (const part of ["`references/PHENOMENOLOGY-AND-REPRESENTATION.md`", "name what kind it is", "whom to tell and how much",
    "once and early, in plain words and without alarm", "a therapist experienced with early sexual trauma",
    "without asserting that abuse happened", "evidence of current risk to someone"]) assert.ok(pointer.includes(part), part);
  assert.deepEqual(unservedReferenceMentions(skill), []);
});

test("every response, review and repair role carries the rules once, inside the shared longitudinal rules", () => {
  assert.equal(count(longitudinalClinicalRules, untellableShameRules), 1);
  assert.ok(sharedClinicalRules.includes(longitudinalClinicalRules));
  for (const [role, prompt] of rolePrompts()) {
    assert.equal(count(prompt.system, untellableShameRules), 1, `${role} carries the untellable-shame rules once`);
    for (const code of FAILURES) assert.equal(count(prompt.system, `- ${code}: `), 1, `${role} names ${code} once`);
  }
});

test("the owner amendment and the graph bind the rule, and the compiled projections follow", () => {
  const amendments = json("../guides/owner-amendments.json");
  const manifest = json("../guides/manifest.json");
  assert.equal(amendments.version, "owner-amendments-2026-10-28-r18");
  assert.equal(manifest.sources.find((source) => source.id === "owner-amendments").version, amendments.version);
  assert.equal(amendments.items.length, 71);
  const item = amendments.items.find((entry) => entry.id === AMENDMENT);
  assert.equal(item?.status, "owner-approved");
  assert.equal(item.domain, "cross-guide");
  assert.equal(item.approvedAt, "2026-10-28");
  // The amendment carries the owner's sentences (the module words them for the model) and the two additions.
  for (const sentence of [
    "Shame often guards something the person believes they can't tell anyone: a feeling, desire, fantasy, attraction, dream, memory or act they expect would bring rejection or alarm.",
    "Keeping it secret keeps the self-rejection going; being understood without flinching loosens it.",
    "Assume this may be there whenever shame is strong, journal or no journal.",
    "name what it is (feeling, fantasy, dream, uncertain memory, accidental exposure, chosen act), keep it apart from the person's worth and from intent, and never answer with alarm, moralizing or a refusal script.",
    "Help the person choose whom to tell and how much: a therapist they feel safe with, asked first what they must report or write down; a friend who has shown ease with taboo subjects.",
    "Start with the general kind of thing, ask before giving details, see how a smaller truth is received, and slow down or stop if the listener seems alarmed.",
    "When the AI can't take a topic on, say so as soon as it matters: what it can't help with, that this is a limit of the tool and not a verdict on the person, and where a human can help.",
    "Early in the work, in plain words and without alarm, say once that some topics may reach the limits of what the AI can help with",
    "never as a warning about the person",
    "offer the option of a therapist experienced with early sexual trauma, without asserting that abuse happened.",
    "Accidentally seeing illegal material isn't seeking it: don't save or share it, report it if you wish, and ask a lawyer about anything legal.",
    "Send journal or conversation material for outside review only when there's evidence of current risk to someone, never for taboo content, dreams, fantasies or a past accidental exposure.",
    "Current danger to anyone is never hidden under this rule"
  ]) assert.ok(item.text.includes(sentence), sentence);

  const bindings = [
    ["../guide-graphs/candidates/inner-child.graph.json", ["IC.COMMON_HUMANITY"]],
    ["../guide-graphs/candidates/cross-guide.graph.json", ["ROUTE.INFLUENCE_INTERNAL", "ROUTE.COMMUNITY_SUPPORT"]]
  ];
  for (const [path, ids] of bindings) {
    const graph = json(path);
    for (const id of ids) {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      assert.ok(node?.sourceRefs.includes(AMENDMENT), id);
      assert.ok(node.recommendations.some((line) => /can't tell anyone/u.test(line)), `${id} teaches the rule`);
      assert.ok(node.avoid.length > 0);
    }
  }
  const community = json("../guide-graphs/candidates/cross-guide.graph.json").nodes.find((node) => node.id === "ROUTE.COMMUNITY_SUPPORT");
  assert.match(community.recommendations.at(-2), /whom to tell and how much/u);
  assert.match(community.recommendations.at(-1), /a limit of the tool and not a verdict on the person/u);
  assert.match(community.recommendations.at(-1), /therapist experienced with early sexual trauma without asserting that abuse happened/u);
  assert.match(community.avoid.at(-1), /outside review without evidence of current risk to someone/u);
  assert.match(community.effects.requiredNuance.at(-1), /never extends to concealing current danger to anyone/u);

  const bundle = json("../guide-graphs/compiled/bundle.json");
  assert.equal(bundle.stats.ownerAmendmentCount, 71);
  for (const id of ["IC.COMMON_HUMANITY", "ROUTE.INFLUENCE_INTERNAL", "ROUTE.COMMUNITY_SUPPORT"]) {
    const node = bundle.graphs.flatMap((graph) => graph.nodes).find((candidate) => candidate.id === id);
    assert.ok(node?.sourceRefs.includes(AMENDMENT), `${id} in the compiled bundle`);
  }
  assert.ok(read("../guide-graphs/source-maps/owner-amendments.json").includes(AMENDMENT));
});

test("the public guide handoff queues one scoped section and does not publish anything", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^Status: \*\*PENDING\*\*$/m);
  assert.match(queue, /^Queue version: `2026-10-28-r15`$/m);
  const start = queue.indexOf("### PGQ-044 — ");
  assert.ok(start > 0);
  assert.equal(queue.indexOf("### PGQ-044 — ", start + 1), -1, "one entry");
  const entry = queue.slice(start);
  for (const field of ["Caused by:", "Teaching point:", "Reader need:", "Already covered:", "Where:"]) {
    assert.match(entry, new RegExp(`^${field} \\S.{40,}$`, "m"), field);
  }
  for (const part of [AMENDMENT, "shame often guards something you believe you can't tell anyone", "keeps the self-rejection going", "name what it is",
    "whom to tell and how much", "ease with the subject, not how close you are", "once, early and in plain words", "as soon as it matters what it can't help with",
    "a limit of the tool and not a verdict on you", "a therapist experienced with early sexual trauma", "Accidentally seeing illegal material is not seeking it",
    "evidence of current risk to someone", "not as a promise about any service or data flow", "a pending queue entry is not publication authority"]) {
    assert.ok(entry.toLowerCase().includes(part.toLowerCase()), part);
  }
  // Neighbouring obligations it reconciles with stay in the queue.
  for (const id of ["PGQ-003", "PGQ-024", "PGQ-039", "PGQ-043"]) assert.match(queue, new RegExp(`### ${id} — `, "u"));
});

test("synthetic regression cases cover the five behaviors and name only this rule's audit failures", () => {
  const cases = json("../corpus/untellable-shame-regression-cases.json");
  assert.equal(cases.schema_version, 1);
  assert.match(cases.privacy, /Entirely synthetic examples/u);
  assert.equal(cases.cases.length, 9);
  assert.equal(new Set(cases.cases.map((fixture) => fixture.id)).size, cases.cases.length, "ids are unique");
  for (const fixture of cases.cases) {
    assert.ok(FAILURES.includes(fixture.expected_failure_code), fixture.id);
    assert.ok(fixture.input.length > 60 && fixture.pass_criterion.length > 70, fixture.id);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /https?:|@|\b\d{4,}\b/u, `${fixture.id} holds no link, address or number`);
  }
  for (const code of FAILURES) assert.ok(cases.cases.some((fixture) => fixture.expected_failure_code === code), `${code} has a case`);
  const byId = new Map(cases.cases.map((fixture) => [fixture.id, fixture]));
  // (1) a taboo fantasy met without alarm and a graded plan, (2) a dream and an uncertain memory named as such,
  // (3) an accidental exposure described accurately, (4) a limit named as the tool's, (5) no outside review for taboo content.
  assert.match(byId.get("fantasy-met-without-alarm").pass_criterion, /No moralizing, no stock refusal/u);
  assert.match(byId.get("graded-disclosure-plan").pass_criterion, /Start with the general kind of thing, ask before giving details/u);
  assert.match(byId.get("dream-named-as-dream").pass_criterion, /Name it as a dream/u);
  assert.match(byId.get("uncertain-memory-early-harm-option").pass_criterion, /without asserting that abuse happened/u);
  assert.match(byId.get("accidental-exposure-not-seeking").pass_criterion, /accidentally seeing illegal material is not seeking it/u);
  assert.match(byId.get("limit-named-as-limit").pass_criterion, /a limit of the tool and not a verdict on the person/u);
  assert.match(byId.get("early-limits-note-once").pass_criterion, /say once, in plain words and without alarm/u);
  assert.match(byId.get("no-outside-review-for-taboo-content").pass_criterion, /not evidence of current risk to someone/u);
  assert.match(byId.get("current-danger-not-hidden").pass_criterion, /Do not help hide current danger/u);
});

test("the lesson and the integration record carry the change", () => {
  const lessons = read("../THERAPY-LESSONS");
  assert.match(lessons, /^# Therapy Prompt Lessons\n\n## 2026-10-28 — Meet untellable shame without alarm/u);
  assert.ok(lessons.includes(AMENDMENT));
  const integration = read("../tasks/untellable-shame-disclosure-20261028/INTEGRATION.md");
  for (const part of [AMENDMENT, "PGQ-044", "untellable-shame-v1", PHENOMENOLOGY, "does not install anything to `stable`"]) assert.ok(integration.includes(part), part);
});
