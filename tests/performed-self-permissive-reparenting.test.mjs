import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { responseFidelityRules } from "../src/prompts/response-fidelity.mjs";
import { longitudinalClinicalRules, sharedClinicalRules } from "../src/prompts/common.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { loadTherapyProtocol, unservedReferenceMentions } from "../src/protocol/therapy-protocol.mjs";

// Owner-approved alignment of the app with two passages of AI guide r8 that the graph did not yet carry: the performed self
// ("From Survival to Experimental Play", IC.IDENTITY_PLAY) and the permissive-reparenting warning paired with forced adulthood
// ("The Inner Guide Comes Later", IC.GUIDE_LATER). The wording is the owner's; nothing here is a new therapy claim or a new owner
// amendment. Every example is synthetic. These static tests show where the lines are written, bound, compiled, planned, served
// and mirrored; they do not show that a model follows them.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const IDENTITY = "IC.IDENTITY_FORMATION";
const PROTECTOR = "IC.PROTECTOR_ACTION";
const LATER = "IC.GUIDE_LATER";
const IDENTITY_PLAY = "IC.IDENTITY_PLAY";
const FIDELITY = "references/RESPONSE-FIDELITY.md";

const PERFORMED_SELF_RECOMMENDATION = "When childhood was organized around avoiding pain and preserving attachment, attention went into reading danger, meeting other people’s expectations, and keeping the bond, leaving much less room for the ordinary experiments (what do I like, what do I want to try, who am I when nobody is grading me) through which identity grows by trial and error. When curiosity or mistakes brought ridicule, punishment, or withdrawal of love, the performed self got better at surviving while the less-practiced self stayed blurry. Recovery includes more than uncovering a fully formed “true self” hidden underneath: some of it is developmental pl/ork (play + work) done late, creating enough safety for preference, curiosity, and experimentation to grow.";
const TRUE_SELF_AVOID = "Do not assume a fully formed true self is merely hidden and waiting to be uncovered.";
const FAKE_PART_AVOID = "Do not set up the performed self as a “fake” part to erase; the aim is a more workable internal relationship, not a new division between the acceptable self and another self that must disappear.";
const LARGE_ACTION_AVOID = "Do not choose an action so large that failure becomes new evidence of unreliability.";
const ESCAPE_AVOID = "Do not mistake escape from anything difficult for self-love: reparenting without direction can become permissive, and a small chosen ask can be care too.";
const PERMISSIVE_AVOID = "Do not let reparenting become permissive: without direction the child receives attention but does not develop, and candy, screens, and escape from anything difficult can masquerade as self-love. Do not answer that with the opposite trap, forced adulthood (perfect discipline, no visible needs, and very little joy or closeness), where the next adult act may be asking for help, expressing a preference, or letting a safe person see something imperfect, not tightening control again.";
const PURITY_AVOID_START = "Do not turn the Guide into mental-purity policing";
const REVIEW_AVOID_START = "Do not make review punitive";
// The two rules the served references and every response and review role carry, frame-neutral and in one sentence each.
const PERFORMED_SELF_RULE = "Where childhood was organized around avoiding pain and preserving attachment, the performed self may have become skilled at surviving while the less-practiced self stayed blurry; count late developmental pl/ork (play + work: enough safety for preference, curiosity and experimentation to grow) as part of recovery rather than only uncovering a hidden true self, and do not set the performed self up as a \"fake\" part to erase.";
const PERMISSIVE_RULE = "Without direction, self-care in any frame, including reparenting where the person welcomes that frame, can become permissive, giving attention without development while candy, screens and escape from anything difficult masquerade as self-love; the opposite trap is forced adulthood (perfect discipline, no visible needs, very little joy or closeness), where the next adult act may be asking for help, expressing a preference or letting a safe person see something imperfect, not tightening control again.";

const candidateGraph = json("../guide-graphs/candidates/inner-child.graph.json");
const candidate = (id) => candidateGraph.nodes.find((node) => node.id === id);
const nodeIn = (graphs, id) => graphs.flatMap((graph) => graph.nodes).find((node) => node.id === id);
// The plain form of a text, so that the node's straight quotes and the guide's typographic ones compare equal.
const plain = (text) => text.replaceAll("’", "'").replaceAll("“", "\"").replaceAll("”", "\"").replace(/\s+/gu, " ").toLowerCase();

const sourceMap = json("../guide-graphs/source-maps/inner-child-guide.json");
const guideLines = read(`../guides/${sourceMap.file}`).split("\n");
function guideSection(id) {
  const section = sourceMap.sections.find((candidateSection) => candidateSection.id === id);
  assert.ok(section, `${id} is a registered guide section`);
  return plain(guideLines.slice(section.lineStart - 1, section.lineEnd).join("\n"));
}

function rolePrompts() {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
    recentTranscript: "synthetic", userMessage: "synthetic" };
  const packet = { recent_transcript: "synthetic", current_user_message: "synthetic" };
  return [
    ["case extraction", caseExtractionPrompt(context), false],
    ["case audit", caseAuditPrompt(context, {}), true],
    ["candidate", candidatePrompt(context, "synthetic"), true],
    ["critique", critiquePrompt(context, {}, "synthetic", "synthetic"), true],
    ["adjudication", adjudicationPrompt(context, {}, "synthetic"), true],
    ["realization", realizationPrompt(context, {}, "synthetic"), true],
    ["private audit", privateRuntimeAuditPrompt(packet), true],
    ["private repair", privateRuntimeRepairPrompt(packet), true]
  ];
}

test("IC.IDENTITY_FORMATION carries the performed-self recommendation and the do-not-erase line, bound to IC.IDENTITY_PLAY", () => {
  const node = candidate(IDENTITY);
  assert.equal(node.recommendations.length, 4);
  assert.equal(node.recommendations[0], PERFORMED_SELF_RECOMMENDATION);
  // The three earlier recommendations stay, in order, after it.
  assert.match(node.recommendations[1], /^Use private journaling, time without external cues, nature, preference recovery, and low-stakes experiments\.$/u);
  assert.match(node.recommendations[2], /^Protect the beginner from immediate talent judgments\.$/u);
  assert.match(node.recommendations[3], /^Make room for being interested in and enjoying the child/u);
  assert.deepEqual(node.avoid, [TRUE_SELF_AVOID, FAKE_PART_AVOID]);
  // The coined word is kept and glossed once; the line is written to InnerSignal, not to the person.
  assert.equal(count(node.recommendations[0], "pl/ork"), 1);
  assert.ok(node.recommendations[0].includes("pl/ork (play + work)"));
  assert.doesNotMatch(`${node.recommendations[0]} ${FAKE_PART_AVOID}`, /\byou(?:r|rs|rself)?\b/iu);
  // Bound to the guide section, not to a new owner amendment: the references are the ones the node already had.
  assert.deepEqual(node.sourceRefs, ["IC.NO_CLEAR_CHILD", IDENTITY_PLAY, "IC.CHILD_BAD_THINGS", "AMEND.IC.EMOTIONAL_TASK_GUIDANCE"]);
  assert.equal(node.sourceRefs.filter((ref) => ref === IDENTITY_PLAY).length, 1);
  // Activation is unchanged: no clear child state, or identity blur.
  assert.deepEqual(node.activation, { any: [
    { field: "coherent_child_state", op: "in", value: ["unclear", "absent"] },
    { field: "identity_blur", op: "eq", value: "present" }
  ] });
});

test("IC.GUIDE_LATER names the permissive trap and its opposite, forced adulthood, in one avoid line before the purity line", () => {
  const node = candidate(LATER);
  assert.equal(node.avoid.length, 6);
  assert.equal(node.avoid[4], PERMISSIVE_AVOID);
  assert.ok(node.avoid[5].startsWith(PURITY_AVOID_START), "the mental-purity line is still last");
  assert.equal(node.avoid.filter((line) => /permissive/u.test(line)).length, 1, "stated once");
  // Always paired: the warning cannot be read without the trap on the other side.
  assert.match(node.avoid[4], /permissive/u);
  assert.match(node.avoid[4], /forced adulthood \(perfect discipline, no visible needs, and very little joy or closeness\)/u);
  assert.match(node.avoid[4], /asking for help, expressing a preference, or letting a safe person see something imperfect, not tightening control again/u);
  assert.doesNotMatch(node.avoid[4], /\byou(?:r|rs|rself)?\b/iu);
  // The guide section was already a source, the gate is unchanged, and the recommendations are as they were.
  assert.ok(node.sourceRefs.includes(LATER));
  assert.equal(node.sourceRefs.filter((ref) => ref === LATER).length, 1);
  assert.equal(node.recommendations.length, 4);
  assert.match(node.recommendations[3], /^Use standards for chosen conduct and cultivation rather than demanding a perfectly clean stream of thoughts or sensations/u);
  assert.deepEqual(node.activation.all.map((condition) => condition.field), ["inner_adult_access", "coherent_child_state", "orientation"]);
});

test("IC.PROTECTOR_ACTION carries one early line after its action-size line, bound to IC.GUIDE_LATER, and keeps its pinned ends", () => {
  const node = candidate(PROTECTOR);
  assert.equal(node.avoid.length, 6);
  assert.equal(node.avoid[1], LARGE_ACTION_AVOID, "the existing line is kept");
  assert.equal(node.avoid[2], ESCAPE_AVOID, "the new line sits immediately after it");
  assert.ok(node.avoid.at(-1).startsWith(REVIEW_AVOID_START), "the final avoid line stays last");
  assert.match(node.recommendations.at(-1), /without harsh judgment/u);
  // It is about escape from anything difficult, never about leaving an unsafe place: the node still names those as protection.
  assert.match(ESCAPE_AVOID, /escape from anything difficult/u);
  assert.doesNotMatch(ESCAPE_AVOID, /\b(?:leave|leaving|left|unsafe|exit)\b/iu);
  assert.match(node.recommendations[0], /an unsafe exchange ended, or help requested/u);
  assert.match(node.recommendations.join(" "), /Choosing not to act on an unsuitable attraction can be a compassionate protective response/u);
  // Bound to the Guide section that carries the warning; the earlier eight references are unchanged and in order.
  assert.equal(node.sourceRefs.filter((ref) => ref === LATER).length, 1);
  assert.deepEqual(node.sourceRefs.filter((ref) => ref !== LATER), [
    "IC.PROTECTOR_VISIBLE", "IC.ADULT_APPRENTICE", "AMEND.CROSS.LITERATURE_ACTION_REVIEW", "AMEND.IC.WISDOM_CORE",
    "AMEND.IC.NONPUNITIVE_REVIEW", "AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM",
    "AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025", "AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026"
  ]);
  assert.equal(node.sourceRefs.indexOf(LATER), 2, "listed with the other guide sections, before the amendments");
});

test("the wording stays inside the owner's words in the guide sections it is bound to", () => {
  const play = guideSection(IDENTITY_PLAY);
  const later = guideSection(LATER);
  // Performed self: each piece of the recommendation and of the do-not-erase line is the guide's own.
  for (const piece of [
    "avoiding pain and preserving attachment", "reading danger", "meeting other people's expectations", "keeping the bond",
    "what do i like", "what do i want to try", "who am i when nobody is grading me", "ridicule, punishment, or withdrawal of love",
    "better at surviving while the less-practiced self", "blurry", "fully formed \"true self\" hidden underneath",
    "developmental pl/ork", "enough safety for preference, curiosity, and experimentation",
    "a more workable internal relationship, not a new division between the acceptable self and another self that must disappear",
    "a \"fake\" part"
  ]) {
    assert.ok(plain(`${PERFORMED_SELF_RECOMMENDATION} ${FAKE_PART_AVOID}`).includes(piece), `the node carries: ${piece}`);
    assert.ok(play.includes(piece), `the guide section says: ${piece}`);
  }
  // Permissive reparenting and forced adulthood, as one passage of the Guide section.
  for (const piece of [
    "reparenting", "become permissive", "receives attention but doesn't develop",
    "candy, screens, and escape from anything difficult can masquerade as self-love", "the opposite trap is forced adulthood",
    "perfect discipline, no visible needs, and very little joy or closeness",
    "asking for help, expressing a preference, or letting a safe person see something imperfect", "not tightening control again"
  ]) {
    assert.ok(later.includes(piece), `the guide section says: ${piece}`);
  }
  for (const piece of [
    "candy, screens, and escape from anything difficult can masquerade as self-love", "forced adulthood",
    "perfect discipline, no visible needs, and very little joy or closeness",
    "asking for help, expressing a preference, or letting a safe person see something imperfect", "not tightening control again"
  ]) {
    assert.ok(plain(PERMISSIVE_AVOID).includes(piece), `the Guide node carries: ${piece}`);
  }
  assert.ok(plain(ESCAPE_AVOID).includes("escape from anything difficult"));
  assert.ok(plain(ESCAPE_AVOID).includes("reparenting without direction can become permissive"));
  // The sections are the ones the three nodes name, so the binding is to the guide and not to a new amendment.
  const amendments = json("../guides/owner-amendments.json");
  assert.equal(amendments.items.some((item) => /PERFORMED|PERMISSIVE|FORCED_ADULT|IDENTITY_PLAY/u.test(item.id)), false, "no owner amendment for this change");
});

test("the compiled bundle, the compiled inner-child graph and a fresh compile all carry the three nodes as the source writes them", async () => {
  const bundle = json("../guide-graphs/compiled/bundle.json");
  const graph = json("../guide-graphs/compiled/inner-child-directed-graph.json");
  const fresh = await compileGuideGraphs({ write: false });
  for (const id of [IDENTITY, PROTECTOR, LATER]) {
    const source = candidate(id);
    const compiled = nodeIn(bundle.graphs, id);
    assert.deepEqual(compiled, nodeIn(fresh.graphs, id), `${id}: the committed bundle is what the source compiles to`);
    assert.deepEqual(nodeIn([graph], id), compiled, `${id}: the compiled graph file agrees with the bundle`);
    for (const field of ["recommendations", "avoid", "sourceRefs"]) assert.deepEqual(compiled[field], source[field], `${id} ${field}`);
  }
  // The Obsidian projection is generated from the same nodes and holds the new lines.
  const note = (id) => read(`../authoring/obsidian/current/nodes/inner-child-directed-graph/${id}.md`);
  assert.ok(note(IDENTITY).includes(PERFORMED_SELF_RECOMMENDATION));
  assert.ok(note(IDENTITY).includes(FAKE_PART_AVOID));
  assert.ok(note(PROTECTOR).includes(ESCAPE_AVOID));
  assert.ok(note(LATER).includes(PERMISSIVE_AVOID));
});

test("the planner puts each line in front of the model where its node applies, and the early line reaches plans the late node does not", async () => {
  const { graphs } = await compileGuideGraphs({ write: false });
  const plan = (variables) => planFromGraphs({ graphs, variables, unknowns: [] });
  const noClearChild = json("../corpus/graph-cases/G008.json").variables;
  const guideReady = json("../corpus/graph-cases/G010.json").variables;
  const once = (list, line) => assert.equal(list.filter((entry) => entry === line).length, 1, line);

  // A person with unstable preferences and a fuller inner adult: the identity node is selected with its recommendation and both avoid lines.
  const identity = plan({ ...noClearChild, inner_adult_access: "available" });
  const selected = identity.selectedNodes.find((node) => node.id === IDENTITY);
  assert.ok(selected, "the identity node is selected");
  assert.equal(selected.recommendations[0], PERFORMED_SELF_RECOMMENDATION);
  once(identity.avoid, FAKE_PART_AVOID);
  assert.equal(identity.avoid.indexOf(FAKE_PART_AVOID), identity.avoid.indexOf(TRUE_SELF_AVOID) + 1);

  // The same person earlier in the work: the late Guide node is not active, yet the early line is in the plan, right after the action-size line.
  const early = plan(noClearChild);
  assert.ok(early.selectedNodes.some((node) => node.id === PROTECTOR));
  assert.equal(early.trace.some((item) => item.id === LATER), false, "the late Guide node is gated out");
  once(early.avoid, ESCAPE_AVOID);
  assert.equal(early.avoid.indexOf(ESCAPE_AVOID), early.avoid.indexOf(LARGE_ACTION_AVOID) + 1);
  assert.equal(early.avoid.includes(PERMISSIVE_AVOID), false);

  // Ready for the Guide: the paired warning arrives as one line.
  const later = plan(guideReady);
  assert.ok(later.selectedNodes.some((node) => node.id === LATER));
  once(later.avoid, PERMISSIVE_AVOID);
  // Ready for the Guide and protecting as well: both lines arrive, each once.
  const both = plan({ ...guideReady, protective_response: "present" });
  for (const id of [PROTECTOR, LATER]) assert.ok(both.selectedNodes.some((node) => node.id === id), id);
  once(both.avoid, ESCAPE_AVOID);
  once(both.avoid, PERMISSIVE_AVOID);
  // The node's own selection gate is not loosened: with no identity blur and a coherent child state it stays out of the plan.
  const settled = plan({ ...noClearChild, coherent_child_state: "present", identity_blur: "absent" });
  assert.equal(settled.trace.some((item) => item.id === IDENTITY), false);
  assert.equal(settled.avoid.includes(FAKE_PART_AVOID), false);
});

test("the two rules are adjacent bullets of the response-fidelity rules, mirrored byte for byte in the served reference and frame-neutral", () => {
  const bullets = responseFidelityRules.split("\n").filter((line) => line.startsWith("- "));
  const start = bullets.indexOf(`- ${PERFORMED_SELF_RULE}`);
  assert.ok(start >= 0, "the performed-self rule is a bullet");
  assert.equal(bullets[start + 1], `- ${PERMISSIVE_RULE}`, "the permissive-reparenting rule follows it");
  assert.equal(count(responseFidelityRules, PERFORMED_SELF_RULE), 1);
  assert.equal(count(responseFidelityRules, PERMISSIVE_RULE), 1);
  assert.ok(responseFidelityRules.indexOf(PERMISSIVE_RULE) < responseFidelityRules.indexOf("RESPONSE FIDELITY AUDIT FAILURES"), "among the rules, not the audit failures");
  // One sentence each, short for what they carry.
  for (const rule of [PERFORMED_SELF_RULE, PERMISSIVE_RULE]) {
    assert.ok(rule.length < 520, `${rule.length} characters`);
    assert.equal(count(rule, ". "), 0, "one sentence");
    assert.doesNotMatch(rule, /\byou(?:r|rs|rself)?\b/iu, "written to InnerSignal, not to the person");
    assert.doesNotMatch(rule, /inner[- ]child|younger self|untellable/iu, "no frame is required");
    assert.deepEqual(unservedReferenceMentions(rule), []);
  }
  assert.match(PERMISSIVE_RULE, /in any frame, including reparenting where the person welcomes that frame/u);
  assert.doesNotMatch(`${PERFORMED_SELF_RULE} ${PERMISSIVE_RULE}`, /(?:completed|enacted) reparenting/iu);

  const reference = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  assert.equal(reference.slice(reference.indexOf("RESPONSE FIDELITY AND PRACTICAL CARE VALUE")).trim(), responseFidelityRules.trim());
  assert.equal(count(reference, PERFORMED_SELF_RULE), 1);
  assert.equal(count(reference, PERMISSIVE_RULE), 1);
  // Served to the host through the protocol loader, from this one file only; no new plugin file carries them.
  const protocol = loadTherapyProtocol();
  assert.equal(protocol.files.find((file) => file.path === FIDELITY).content, reference);
  for (const file of protocol.files) {
    if (file.path !== FIDELITY) assert.equal(file.content.includes("masquerade as self-love"), false, `${file.path} does not carry the rule`);
  }
});

test("both rules reach every response and review role that carries the response-fidelity rules, and the extraction role does not", () => {
  assert.equal(count(longitudinalClinicalRules, PERFORMED_SELF_RULE), 1);
  assert.equal(count(longitudinalClinicalRules, PERMISSIVE_RULE), 1);
  assert.ok(sharedClinicalRules.includes(longitudinalClinicalRules));
  for (const [role, prompt, carriesFidelity] of rolePrompts()) {
    for (const rule of [PERFORMED_SELF_RULE, PERMISSIVE_RULE]) {
      assert.equal(count(prompt.system, rule), carriesFidelity ? 1 : 0, `${role} carries the rule ${carriesFidelity ? "once" : "not at all (it does not carry the fidelity rules)"}`);
    }
  }
});

test("five synthetic scenes cover the performed self, permissive self-care, the forced-adulthood swing, an early escape and a protective exit", () => {
  const cases = json("../corpus/performed-self-permissive-regression-cases.json");
  assert.equal(cases.schema_version, 1);
  assert.match(cases.privacy, /Entirely synthetic examples with invented people/u);
  assert.equal(cases.cases.length, 5);
  assert.equal(new Set(cases.cases.map((fixture) => fixture.id)).size, cases.cases.length, "ids are unique");
  assert.deepEqual(cases.cases.map((fixture) => fixture.reading), [
    "performed-self-not-fake", "permissive-reparenting", "forced-adulthood-trap", "early-escape-not-protection", "protective-exit-supported"
  ]);
  assert.deepEqual(cases.cases.map((fixture) => fixture.node), [IDENTITY, LATER, LATER, PROTECTOR, PROTECTOR]);
  for (const fixture of cases.cases) {
    assert.ok(fixture.input.length > 250 && fixture.pass_criterion.length > 400, fixture.id);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /https?:|@|\b\d{4,}\b/u, `${fixture.id} holds no link, address or number`);
    assert.match(fixture.pass_criterion, /\bDo not\b/u, fixture.id);
    assert.doesNotMatch(fixture.pass_criterion, /\b(?:you|your)\b/iu, `${fixture.id} is written about the person, not to them`);
    // The scenes do not hand the model the answer: no input uses the guide's own terms for what the reply should say.
    assert.doesNotMatch(fixture.input, /permissive|forced adulthood|performed self|pl\/ork|true self|less-practiced|masquerade/iu, fixture.id);
  }
  const byId = new Map(cases.cases.map((fixture) => [fixture.id, fixture]));
  const performed = byId.get("performed-self-as-fake-part").pass_criterion;
  assert.match(performed, /Do not agree that the performed self is a fake to be erased/u);
  assert.match(performed, /do not promise that a fully formed true self is waiting underneath/u);
  assert.match(performed, /skilled at surviving, while the self that had little room to try things stayed blurry/u);
  assert.match(performed, /a more workable relationship between the two, not a new split between an acceptable self and another self that must disappear/u);
  assert.match(performed, /late developmental pl\/ork \(play and work\)/u);
  const permissive = byId.get("permissive-self-care-called-self-love").pass_criterion;
  assert.match(permissive, /care without any direction can become permissive/u);
  assert.match(permissive, /candy, screens and escape from anything difficult can look like self-love without being it/u);
  assert.match(permissive, /do not hand him a rigid discipline plan/u);
  const forced = byId.get("forced-adulthood-after-indulgence").pass_criterion;
  assert.match(forced, /Name both traps together/u);
  assert.match(forced, /perfect discipline with no visible needs and very little joy or closeness, is forced adulthood/u);
  assert.match(forced, /asking for help, saying one preference or letting a safe person see something imperfect, not tightening control again/u);
  assert.match(forced, /do not swing back to indulgence/u);
  const early = byId.get("escape-called-self-love-early").pass_criterion;
  assert.match(early, /reparenting without any direction can become permissive, because escape from anything difficult is not the same as care/u);
  assert.match(early, /a small chosen ask can be care too/u);
  assert.match(early, /failing it would not become new evidence/u);
  // The over-application guard: a protective exit is protection, and the permissive-reparenting warning is not turned against it.
  const exit = byId.get("protective-exit-is-not-escape").pass_criterion;
  assert.match(exit, /ending an unsafe exchange is a protective action and counts as care/u);
  assert.match(exit, /do not turn the warning about permissive reparenting against her/u);
  assert.match(exit, /do not ask her to justify the leaving/u);
});

test("the lesson, the state section and the public-guide queue carry the change", () => {
  const lessons = read("../THERAPY-LESSONS");
  assert.match(lessons, /\n## 2026-10-31 — Treat the performed self as a survival skill, not a fake part, and keep care from turning permissive or forced\n/u);
  const lesson = lessons.slice(lessons.indexOf("## 2026-10-31 — Treat the performed self"));
  const lessonBody = lesson.slice(0, lesson.indexOf("\nThis root log records"));
  for (const part of [IDENTITY_PLAY, LATER, IDENTITY, PROTECTOR, "RESPONSE-FIDELITY.md", "no new owner amendment", "PGQ-050", "do not show that any model follows the rules"]) {
    assert.ok(lessonBody.includes(part), part);
  }
  const state = read("../state/CODEX-CURRENT-STATE.md");
  assert.equal((state.match(/^Updated: /gmu) ?? []).length, 1, "exactly one Updated line");
  const start = state.indexOf("## Performed self and permissive reparenting");
  assert.ok(start > 0, "the state section exists");
  const section = state.slice(start, state.indexOf("\n## ", start + 5));
  for (const part of [IDENTITY_PLAY, LATER, IDENTITY, PROTECTOR, "RESPONSE-FIDELITY.md", "PGQ-050", "no new owner amendment", "2026-10-31-r17"]) {
    assert.ok(section.includes(part), part);
  }
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^### PGQ-050 — How this guide differs from schema therapy$/mu);
});
