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
// and bound, and that each added text keeps one audience; they do not show that a model follows the rules.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const AMENDMENT = "AMEND.CROSS.UNTELLABLE_SHAME_AND_DISCLOSURE_20261028";
const PHENOMENOLOGY = "references/PHENOMENOLOGY-AND-REPRESENTATION.md";
const SKILL = "../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md";
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
const AUDIENCE_LINE = "These are instructions to InnerSignal. \"The person\" is the client. Advice meant for the person is written as advice to give them, never as an instruction to InnerSignal.";
// The owner's own sentences, kept whole, and the clauses of the two additions, as the rule words them for InnerSignal.
const OWNER_CLAUSES = [
  "Shame often guards something the person believes they can't tell anyone: a feeling, desire, fantasy, attraction, dream, memory or act they expect would bring rejection or alarm.",
  "Secrecy can add to the self-rejection, and being understood without flinching can loosen it, but relief never depends on telling anyone.",
  "Assume this may be there whenever shame is strong, journal or no journal.",
  "Name what it is (feeling, fantasy, dream, uncertain memory, accidental exposure, chosen act), keep it apart from the person's worth and from intent, and never answer with alarm, moralizing or a refusal script.",
  "Help the person choose whom to tell and how much. Advice to give them: a therapist they feel safe with, asked first, in general terms, what the therapist must report or write down; a friend who has shown ease with taboo subjects;",
  "start with the general kind of thing, ask before giving details, see how a smaller truth is received, and slow down or stop if the listener seems alarmed;",
  "Whether, when and to whom to tell is the person's choice: do not press for disclosure or choose the listener for them. Disclosure is never a default treatment, a test of worth, or something owed to a hostile or unpredictable listener.",
  "When a topic is beyond what InnerSignal can help with, say so as soon as it matters: what it can't help with, that this is a limit of the tool and not a verdict on the person, and where a human can help.",
  "tell them once, in plain words and without alarm, that some topics may be beyond what InnerSignal can help with and that if one is, it will say so and point to a person who can help.",
  "Never present this as a warning about the person",
  "offer, as an option, a therapist experienced with early sexual trauma, without asserting that abuse happened.",
  "tell them accurately and without alarm that coming across it by accident is not seeking it.",
  "Advice to give them: not to save or share it; that reporting the material itself, for example to the platform where it appeared, is their own choice; and to ask a lawyer about any legal worry.",
  "InnerSignal itself never reports the person or passes on what they wrote, does not assess their legal exposure, and does not press for details of what was seen",
  "Do not flag, route or recommend routing journal or conversation material for outside review because of taboo content, dreams, fantasies or a past accidental exposure.",
  "Only evidence of current risk to someone justifies it, and that evidence stays under the ordinary safety rules, which these rules never override."
];
// A pronoun addressed to the client. Every text below is written to InnerSignal or to the reviewer, never to the client.
const SECOND_PERSON = /\byou(?:r|rs|rself|rselves)?\b/iu;
// The sentence the owner objected to: advice to the client, readable as an instruction to report people.
const CLIENT_ADDRESSED_ADVICE = /report it if you wish|don't save or share it|if you wish/iu;

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

function stateSection() {
  const state = read("../state/CODEX-CURRENT-STATE.md");
  const start = state.indexOf("## Untellable shame and graded disclosure");
  assert.ok(start >= 0, "the state checkpoint has a section for this change");
  const next = state.indexOf("\n## ", start + 4);
  return state.slice(start, next < 0 ? undefined : next);
}

function lessonEntry() {
  const lessons = read("../THERAPY-LESSONS");
  const start = lessons.indexOf("## 2026-10-28 — Meet untellable shame without alarm");
  assert.ok(start >= 0, "the lesson exists");
  const next = lessons.indexOf("\n## ", start + 4);
  return lessons.slice(start, next < 0 ? undefined : next);
}

// The strings a graph node carries about this rule, wherever the node keeps them.
function topicLines(node) {
  const topic = /tell anyone|whom to tell|outside review|early sexual|taboo|can help with|disclosure|confidential/iu;
  return [...node.recommendations, ...node.avoid, ...(node.effects?.forbiddenOverclaims ?? []), ...(node.effects?.requiredNuance ?? [])]
    .filter((line) => topic.test(line));
}

test("the rule is written once, carries the owner's sentences and both additions, and names its audit failures", () => {
  for (const clause of OWNER_CLAUSES) assert.ok(untellableShameRules.includes(clause), clause);
  assert.ok(untellableShameRules.startsWith(`\nUNTELLABLE SHAME AND GRADED DISCLOSURE (untellable-shame-v1)\n${AUDIENCE_LINE}\n- Shame often guards`));
  assert.match(untellableShameRules, /\n\nUNTELLABLE SHAME AUDIT FAILURES\n- DISCLOSURE_MET_WITH_ALARM: /u);
  assert.ok(untellableShameRules.endsWith("without evidence of current risk to someone.\n"));
  for (const code of FAILURES) {
    assert.equal(count(untellableShameRules, `\n- ${code}: `), 1, code);
    assert.equal(responseFidelityRules.includes(code), false, `${code} is new, not a renamed response-fidelity code`);
  }
  assert.equal(untellableShameRules.split("\n").filter((line) => /^- [A-Z_]+: /u.test(line)).length, FAILURES.length);
  // Aligned with the shame-appraisal amendment of 29 Oct: telling is never required and never a test of worth.
  assert.ok(untellableShameRules.includes("\n- DISCLOSURE_PRESSED_OR_UNGRADED: presses the person to tell, treats telling as a required treatment or a test of worth, chooses the listener, or sends them to a listener without the general-first, ask-before-details, watch-the-response steps.\n"));
  assert.deepEqual(unservedReferenceMentions(untellableShameRules), []);
});

test("the rules agree with the rules already in force: no concealment of danger, no abuse asserted, no preventive referral", () => {
  // Naming a thing apart from intent does not suspend the separate question of reported intent or planning.
  assert.match(untellableShameRules, /does not suspend the separate question of reported current intent, planning or conduct that endangers someone/u);
  assert.match(untellableShameRules, /None of this extends to helping hide current danger to the person or to someone else, which comes first\./u);
  assert.match(untellableShameRules, /A chosen act is still named as chosen, with responsibility and the protection of anyone affected in view; naming it neither excuses it nor condemns the person\./u);
  // The early-sexual-harm option stays inside the felt-violation rule and the 26 Oct feeling-and-agency amendment.
  assert.match(untellableShameRules, /The trigger is the person's own report of feeling or suspecting it, not InnerSignal's inference from a fantasy, dream or image\./u);
  assert.match(untellableShameRules, /neither confirmed nor denied, no perpetrator named, no memory reconstruction steered/u);
  assert.match(untellableShameRules, /not a preventive, reporting or institutional referral/u);
  assert.match(responseFidelityRules, /A felt violation or fear can be supported and explored without identifying a perpetrator or asserting recovered abuse/u);
  assert.match(responseFidelityRules, /Do not automatically route shame about feelings alone to an institutional prevention service/u);
  assert.match(responseFidelityRules, /In a dream, vision, or intoxicated account, words attributed to another person remain words experienced in that state/u);
  // The existing instruction not to help conceal current suicidal intent or imminent danger is unchanged.
  const skill = read(SKILL);
  assert.match(skill, /Do not encourage concealment or false denial of current suicidal intent, a plan, inability to stay safe or imminent danger\./u);
  // InnerSignal keeps its own limits on what it writes; understanding does not need explicit detail.
  assert.match(untellableShameRules, /Understanding the material does not require explicit detail, and InnerSignal need not write or elaborate any\./u);
  // Outside review is not a report by InnerSignal, and the ordinary safety rules are never overridden.
  assert.match(untellableShameRules, /Outside review means passing material to anyone beyond the person's own care and chosen supporters, such as a reviewer, authority or service\./u);
});

test("the served phenomenology reference mirrors the module and no other served file carries it", () => {
  const protocol = loadTherapyProtocol();
  assert.equal(THERAPY_PROTOCOL_FILES.length, 9, "no served file was added");
  const served = protocol.files.find((file) => file.path === PHENOMENOLOGY);
  assert.ok(served?.content.endsWith(untellableShameRules), "the served reference ends with the module text, byte for byte");
  assert.match(served.content, /\n## Untellable shame and graded disclosure\n\nOwner request, 26 October 2026\. Shared semantic rules; not proof of model adherence\.\n\nUNTELLABLE SHAME AND GRADED DISCLOSURE/u);
  assert.ok(served.content.includes(AUDIENCE_LINE), "the served rules open by naming their audience");
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
  const skill = read(SKILL);
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
  assert.equal(amendments.version, "owner-amendments-2026-10-30-r20");
  assert.equal(manifest.sources.find((source) => source.id === "owner-amendments").version, amendments.version);
  assert.equal(amendments.items.length, 73);
  const item = amendments.items.find((entry) => entry.id === AMENDMENT);
  assert.equal(item?.status, "owner-approved");
  assert.equal(item.domain, "cross-guide");
  assert.equal(item.approvedAt, "2026-10-28");
  // The shame-appraisal amendment merged from main stays beside this one, and this one agrees with it.
  const appraisal = amendments.items.find((entry) => entry.id === "AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029");
  assert.equal(appraisal?.status, "owner-approved");
  assert.match(appraisal.text, /Disclosure to an unpredictable or hostile audience is not a default treatment or behavioral experiment\./u);
  // The amendment is written to InnerSignal in the voice of the other amendments, and carries the owner's sentences and both additions.
  for (const sentence of [
    "Shame often guards something a person believes they can't tell anyone: a feeling, desire, fantasy, attraction, dream, memory or act they expect would bring rejection or alarm.",
    "Secrecy can add to the self-rejection and being understood without flinching can loosen it, but relief never depends on telling anyone; assume this may be present whenever shame is strong.",
    "Read such material as ordinary therapeutic material: name its kind (feeling, fantasy, dream, uncertain memory, accidental exposure, chosen act), keep it apart from the person's worth and intent, and never answer with alarm, moralizing or a refusal script.",
    "Help the person choose whom to tell and how much, by the listener's ease with the subject rather than closeness: the general kind of thing first, asking before details, watching how a smaller truth is received, and slowing down or stopping at alarm; with a therapist, asking first what the therapist must report.",
    "Disclosure is never a default treatment, a test of worth, or owed to a hostile or unpredictable listener.",
    "Name a limit of the AI as soon as it matters, as a limit of the tool and not a verdict on the person, with a human who can help, and mention once, early and after the welcome, that some topics may reach that limit.",
    "When the person feels or suspects early sexual harm, offer a therapist experienced with early sexual trauma as an option, without asserting abuse.",
    "tell them that accidental exposure is not seeking it, and advise them not to save or share it, that reporting the material itself is their choice, and to ask a lawyer about legal worries; the AI never reports the person and does not assess legal exposure.",
    "Do not route journal or conversation material for outside review because of taboo content, dreams, fantasies or a past accidental exposure; only evidence of current risk does, under the ordinary safety rules.",
    "Current danger to anyone is never hidden under this rule, and the rules on felt violations, unchosen feelings versus chosen conduct, shame appraisal and reparability, sensitive referral fit and protective compatibility continue to apply."
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
  assert.match(community.recommendations.at(-2), /whom to tell and how much\. Advice to give them: a therapist they feel safe with, asked first, in general terms, what the therapist must report or write down/u);
  assert.match(community.recommendations.at(-2), /Disclosure is never a default treatment, a test of worth, or something owed to a hostile or unpredictable listener\.$/u);
  assert.match(community.recommendations.at(-1), /Early in the work, after the person has been welcomed, tell them once/u);
  assert.match(community.recommendations.at(-1), /a limit of the tool and not a verdict on the person/u);
  assert.match(community.recommendations.at(-1), /offer a therapist experienced with early sexual trauma as an option, without asserting that abuse happened/u);
  assert.match(community.avoid.at(-1), /outside review without evidence of current risk to someone/u);
  assert.match(community.effects.forbiddenOverclaims.at(-1), /the advice to give the person is to ask a therapist first what the therapist must report or write down/u);
  assert.match(community.effects.requiredNuance.at(-1), /never extends to concealing current danger to anyone/u);

  const bundle = json("../guide-graphs/compiled/bundle.json");
  assert.equal(bundle.stats.ownerAmendmentCount, 73);
  for (const id of ["IC.COMMON_HUMANITY", "ROUTE.INFLUENCE_INTERNAL", "ROUTE.COMMUNITY_SUPPORT"]) {
    const node = bundle.graphs.flatMap((graph) => graph.nodes).find((candidate) => candidate.id === id);
    assert.ok(node?.sourceRefs.includes(AMENDMENT), `${id} in the compiled bundle`);
  }
  assert.ok(read("../guide-graphs/source-maps/owner-amendments.json").includes(AMENDMENT));
});

test("each added text has one audience: rules to InnerSignal, advice for the person marked as such, reporting stated", () => {
  const amendment = json("../guides/owner-amendments.json").items.find((entry) => entry.id === AMENDMENT).text;
  const cross = json("../guide-graphs/candidates/cross-guide.graph.json");
  const inner = json("../guide-graphs/candidates/inner-child.graph.json");
  const nodeLines = [
    ...topicLines(inner.nodes.find((node) => node.id === "IC.COMMON_HUMANITY")),
    ...topicLines(cross.nodes.find((node) => node.id === "ROUTE.INFLUENCE_INTERNAL")),
    ...topicLines(cross.nodes.find((node) => node.id === "ROUTE.COMMUNITY_SUPPORT"))
  ];
  assert.ok(nodeLines.length >= 8, "the nodes' lines about this rule were found");
  const corpus = json("../corpus/untellable-shame-regression-cases.json");
  const pointer = read(SKILL).split("\n").find((line) => line.startsWith("When shame is strong, or the person approaches"));
  const served = loadTherapyProtocol().files.find((file) => file.path === PHENOMENOLOGY).content;
  const texts = [
    ["rule module", untellableShameRules],
    ["served closing section", served.slice(served.indexOf("## Untellable shame and graded disclosure"))],
    ["owner amendment", amendment],
    ["skill pointer", pointer],
    ["lesson", lessonEntry()],
    ["state section", stateSection()],
    ["integration record", read("../tasks/untellable-shame-disclosure-20261028/INTEGRATION.md")],
    ...nodeLines.map((line, index) => [`graph node line ${index}`, line]),
    ...corpus.cases.flatMap((fixture) => [[`${fixture.id} input`, fixture.input], [`${fixture.id} pass criterion`, fixture.pass_criterion]]),
    ["corpus audience note", corpus.audience]
  ];
  for (const [label, text] of texts) {
    assert.doesNotMatch(text, SECOND_PERSON, `${label} addresses no "you": the client is never the reader`);
    assert.doesNotMatch(text, CLIENT_ADDRESSED_ADVICE, `${label} holds no advice phrased to the client`);
    if (/save or share/iu.test(text)) {
      // Advice about accidental exposure is marked as advice to give, says reporting the material is the person's own choice,
      // and says InnerSignal reports no one.
      assert.match(text, /advi[sc]e/iu, `${label} marks the exposure advice as advice`);
      assert.match(text, /reporting the material itself/iu, `${label} says the person may report the material itself`);
      assert.match(text, /never reports the person|reports no one/iu, `${label} says InnerSignal reports no one`);
    }
  }
  // The rule block and its mirror open by naming their audience; the amendment reports to nobody and says so.
  assert.ok(untellableShameRules.includes(`\n${AUDIENCE_LINE}\n`));
  assert.match(amendment, /the AI never reports the person and does not assess legal exposure/u);
  // The retired guide section is gone from every text of this change.
  for (const [label, text] of texts) assert.doesNotMatch(text, /PGQ-044/u, `${label} names no queued guide section`);
});

test("synthetic regression cases cover the behaviors and name only this rule's audit failures", () => {
  const cases = json("../corpus/untellable-shame-regression-cases.json");
  assert.equal(cases.schema_version, 1);
  assert.match(cases.privacy, /Entirely synthetic examples/u);
  assert.match(cases.audience, /written for the reviewer who judges a reply/u);
  assert.equal(cases.cases.length, 10);
  assert.equal(new Set(cases.cases.map((fixture) => fixture.id)).size, cases.cases.length, "ids are unique");
  for (const fixture of cases.cases) {
    assert.ok(FAILURES.includes(fixture.expected_failure_code), fixture.id);
    assert.ok(fixture.input.length > 60 && fixture.pass_criterion.length > 70, fixture.id);
    assert.match(fixture.pass_criterion, /^(?:The reply|After welcoming the person, the reply) /u, `${fixture.id} describes the reply`);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /https?:|@|\b\d{4,}\b/u, `${fixture.id} holds no link, address or number`);
  }
  for (const code of FAILURES) assert.ok(cases.cases.some((fixture) => fixture.expected_failure_code === code), `${code} has a case`);
  const byId = new Map(cases.cases.map((fixture) => [fixture.id, fixture]));
  // (1) a taboo fantasy met without alarm and a graded plan, (2) a dream and an uncertain memory named as such,
  // (3) an accidental exposure described accurately, with and without the question of being reported, (4) a limit named as
  // the tool's, (5) no outside review for taboo content.
  assert.match(byId.get("fantasy-met-without-alarm").pass_criterion, /no moralizing, no stock refusal/u);
  assert.match(byId.get("graded-disclosure-plan").pass_criterion, /advice for the person to weigh/u);
  assert.match(byId.get("graded-disclosure-plan").pass_criterion, /start with the general kind of thing, ask before giving details/u);
  assert.match(byId.get("graded-disclosure-plan").pass_criterion, /does not push full disclosure, treat telling as required or as a test of worth, or choose the listener/u);
  assert.match(byId.get("dream-named-as-dream").pass_criterion, /names it as a dream/u);
  assert.match(byId.get("uncertain-memory-early-harm-option").pass_criterion, /without asserting that abuse happened/u);
  assert.match(byId.get("accidental-exposure-not-seeking").pass_criterion, /accidentally seeing illegal material is not seeking it/u);
  assert.match(byId.get("limit-named-as-limit").pass_criterion, /a limit of the tool and not a verdict on the person/u);
  assert.match(byId.get("early-limits-note-once").pass_criterion, /says once, in plain words and without alarm/u);
  assert.match(byId.get("no-outside-review-for-taboo-content").pass_criterion, /not evidence of current risk to someone/u);
  assert.match(byId.get("current-danger-not-hidden").pass_criterion, /does not help hide current danger/u);
  // The accidental-exposure cases: not seeking, the advice, and that InnerSignal reports no one, with no legal assessment.
  const asked = byId.get("accidental-exposure-asks-about-reporting");
  assert.equal(asked.expected_failure_code, "ACCIDENTAL_EXPOSURE_MISFRAMED");
  assert.match(asked.input, /accidentally saw illegal material/u);
  assert.match(asked.input, /whether InnerSignal will report them/u);
  for (const part of ["accidental exposure is not seeking it", "not to save or share the material", "reporting the material itself",
    "is their own choice", "to ask a lawyer about any legal worry", "InnerSignal reports no one", "does not assess legal exposure",
    "does not press for details of what was seen"]) assert.ok(asked.pass_criterion.includes(part), part);
  for (const id of ["accidental-exposure-not-seeking", "accidental-exposure-asks-about-reporting"]) {
    assert.match(byId.get(id).pass_criterion, /InnerSignal reports no one/u, id);
    assert.match(byId.get(id).pass_criterion, /does not assess legal exposure/u, id);
  }
});

test("the lesson and the integration record carry the change and declare no guide section", () => {
  const lessons = read("../THERAPY-LESSONS");
  assert.match(lessons, /^# Therapy Prompt Lessons\n\n## 2026-10-28 — Meet untellable shame without alarm/u);
  assert.ok(lessons.includes(AMENDMENT));
  const lesson = lessonEntry();
  assert.match(lesson, /InnerSignal reports no one and does not assess legal exposure/u);
  assert.match(lesson, /the reader-facing guide is not changed by this lesson/u);
  const integration = read("../tasks/untellable-shame-disclosure-20261028/INTEGRATION.md");
  for (const part of [AMENDMENT, "untellable-shame-v1", PHENOMENOLOGY, "does not install anything to `stable`",
    "Guide impact: app-only", "no guide section and no public-guide queue entry", "InnerSignal reports no one"]) assert.ok(integration.includes(part), part);
  const section = stateSection();
  assert.ok(section.includes(AMENDMENT));
  assert.ok(section.includes("Guide impact: app-only"));
  // Aligned with the shame-appraisal amendment of 29 Oct: relief never depends on telling, and telling is never a default treatment.
  const never = /disclosure is never a default treatment, a test of worth, or something owed to a hostile or unpredictable listener/iu;
  const served = loadTherapyProtocol().files.find((file) => file.path === PHENOMENOLOGY).content;
  const amendment = json("../guides/owner-amendments.json").items.find((entry) => entry.id === AMENDMENT).text;
  for (const [label, text] of [["rule module", untellableShameRules], ["served closing section", served], ["lesson", lesson], ["state section", section], ["integration record", integration]]) {
    assert.match(text, never, `${label} says disclosure is never a default treatment`);
  }
  for (const [label, text] of [["rule module", untellableShameRules], ["served closing section", served], ["owner amendment", amendment], ["lesson", lesson], ["integration record", integration]]) {
    assert.match(text, /relief never depends on telling anyone/u, `${label} says relief never depends on telling anyone`);
  }
  for (const [label, text] of [["rule module", untellableShameRules], ["served closing section", served], ["owner amendment", amendment], ["lesson", lesson], ["integration record", integration]]) {
    assert.doesNotMatch(text, /keeps? the self-rejection going/u, `${label} does not say that secrecy alone keeps the self-rejection going`);
  }
  assert.match(amendment, /Disclosure is never a default treatment, a test of worth, or owed to a hostile or unpredictable listener\./u);
  assert.match(amendment, /shame appraisal and reparability/u);
});
