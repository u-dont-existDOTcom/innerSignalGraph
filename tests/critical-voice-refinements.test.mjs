import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
import {
  CRITICAL_VOICE, DRAWING, DRAWING_HEADING, GUARD_NEW, GUARD_OLD, GUARD_PHRASE, PARENT_ANCHOR, JOURNAL_ANCHOR, NEXT_HEADING,
  CURRENT_R9_SHA256
} from "./fixtures/issue-215-guide-edits.mjs";

// Owner-approved Inner Child refinements, filed as issue 215 on 31 October 2026: a critical inner voice can be refused without first
// being explained and without assuming it is a protector; the guide's list of proactive protectors no longer names every inner critic;
// and one optional nonverbal practice is offered for anger that is hard to put into words. The guide wording is the issue's approved
// text. The map change refines four existing nodes and adds none. Every example is synthetic. These static tests show where the lines
// are written, bound, compiled, planned, served and mirrored; they do not show that a model follows them.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
// The plain form of a text, so that a node's straight quotes and the guide's typographic ones compare equal.
const plain = (text) => text.replaceAll("’", "'").replaceAll("“", "\"").replaceAll("”", "\"").replace(/\s+/gu, " ").toLowerCase();

const SECTION = "IC.INHERITED_PARENT";
const KERNEL = "IC.CRITICISM_KERNEL";
const GUARD = "IC.MEET_GUARD";
const PROTECTOR = "IC.PROTECTOR_ACTION";
const SHAME = "IC.SHAME_APPRAISAL";
const FIDELITY = "references/RESPONSE-FIDELITY.md";

// The issue's approved wording, with the straight apostrophes the issue has (the guide's are typographic).
const ISSUE_CRITICAL_VOICE = "A critical voice may be replaying something you learned from a parent, trying to protect you from rejection or failure, pointing to a real problem in a cruel way, or doing several of these at once. You don't have to settle which one it is before protecting yourself. You can reject the insult, take seriously anything useful in the message, and ask what the voice is afraid of or trying to accomplish, if that helps. Understanding where the criticism comes from doesn't mean agreeing with it or allowing it to keep attacking you.";
const ISSUE_DRAWING = "If anger is hard to put into words, try drawing or scribbling how it feels. You don't need to make anything recognizable. When you're finished, notice whether something has become clearer: a feeling, an unmet need, a boundary, or something you'd like the adult in you to do. The drawing doesn't have to reveal a hidden memory or produce emotional release to be useful.";

// The new node lines.
const KERNEL_LINE = "When the criticism is an inner voice, it may be replaying something learned from a parent, trying to protect the person from rejection or failure, pointing to a real problem in a cruel way, or doing several of these at once. The person does not have to settle which before protecting themselves: reject the insult, take seriously anything useful in the message, and ask what the voice is afraid of or trying to accomplish only if that helps.";
const GUARD_RECOMMENDATION = "Explore what a critical voice fears or is trying to accomplish only when a protective purpose is plausible and the person finds that useful, treating the answer as a hypothesis; it is not required before the person rejects the insult, sets a boundary or takes relief.";
const GUARD_AVOID = "Do not assume an inner critic is a guard: it may replay a parent, be a self-critical strategy trying to prevent a feared outcome, point to a real problem in a cruel way, or be a blend.";
const PROTECTOR_RECOMMENDATION = "The inner adult may reject the insult and firmly stop degrading inner speech without first settling what the voice is for, keeping compassion, boundaries and accountability for real conduct. Understanding where the criticism comes from does not mean agreeing with it or allowing it to keep attacking.";

// Lines the nodes already carried before this change, kept word for word. They are the "ALREADY COVERED" anchors.
const KERNEL_COVERED = [
  [0, "After the relevant external reality check, ask whether there is a specific supported point inside the criticism worth considering. Separate it from insults, exaggeration or coercive demands."],
  [1, "Where true, acknowledge the specific behavior or make an appropriate repair. Where uncertain, clarification is optional; do not invent a kernel or concede unsupported blame."],
  [3, "Do not equate a rejecting audience's moral verdict with actual responsibility. Identify concretely supported behavior worth repairing, without accepting global contempt."]
];
const KERNEL_SUCCESS = "Accurate responsibility and useful information are retained without swallowing a global verdict or surrendering protection.";
const GUARD_RECOMMENDATIONS_BEFORE = [
  "Treat cynicism, numbness, anger, scrolling, substances, planning, sleep, or dissociation as information about what the system expects.",
  "Ask what the part predicts will happen if it steps back; acknowledge before answering.",
  "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking.",
  "For ordinary-life decisions, treat anxiety and other protective alarms as information about expected danger or overload rather than commands or truth detectors; hear what they are trying to protect, then compare the prediction with evidence, current capacity and later outcomes.",
  "When shame becomes shame about being ashamed, distinguish the initial experience from a secondary self-attack and investigate any useful protective aim without treating the first feeling as a malfunction."
];
const GUARD_AVOID_BEFORE = [
  "Do not classify the voice more confidently than the transcript supports or push past it.",
  "Do not equate listening to a protective alarm with obeying it, and do not use prediction-testing to push past a protector's no to deeper processing or altered-state work, or past hesitation about touch or sex."
];
const GUARD_FORBIDDEN = [
  "Do not definitively label a cynical voice as a guard.",
  "Do not claim that anxiety or another protective alarm proves the feared conclusion is true.",
  "Do not claim that testing a protective prediction authorizes overriding a protector's no to deeper or altered-state work, or hesitation about touch or sex."
];
const GUARD_NUANCE = [
  "The contempt may be child, protector, adult evaluator, or blend.",
  "Protective intent and predictive accuracy are separate: an alarm can be understandable and still be mistaken, outdated, or overprotective.",
  "Consent, immediate safety and possible medical red flags outrank an experiment with the alarm; use a cheap reversible precaution first and interpret afterward."
];
const SHAME_COVERED = {
  recommendations: [
    [1, "When shame matters to the active focus, separate the felt rejection alarm, actual social behavior, predicted judgment, chosen conduct and values, inherited self-treatment, and avoidance or self-blame. These can coexist; ask only distinctions that change the next action."],
    [3, "For genuinely harmful conduct, support specific acknowledgment, realistic reparability, changed behavior and appropriate consequences; release from endless self-punishment does not depend on forgiveness or restored trust."],
    [4, "When shame is followed by shame about being ashamed or other cruel self-criticism, preserve the initial feeling, inquire into any protective purpose of the secondary attack, and change the self-treatment through existing Nurturer, Protector, Guide and guard work."]
  ],
  avoid: [[2, "Do not call the shame feeling itself a malfunction, endorse global worthlessness or conflate involuntary experience with chosen harmful conduct."]],
  success: "Responsibility, legitimate protection, and freedom from an unsupported global verdict are separated clearly enough to support one feasible next move."
};
// Activation and gates, as they were: this change does not loosen any of them.
const SAFETY_NONE = [
  { field: "present_safety", op: "eq", value: "unsafe" }, { field: "orientation", op: "eq", value: "disoriented" },
  { field: "ability_to_stop", op: "eq", value: "no" }, { field: "ability_to_return", op: "eq", value: "no" },
  { field: "dissociation", op: "eq", value: "high" }, { field: "suicidal_state", op: "eq", value: "imminent" }
];
const KERNEL_ACTIVATION = { all: [{ field: "perspective_practice", op: "eq", value: "criticism_kernel" }], none: SAFETY_NONE };
const GUARD_ACTIVATION = { any: [
  { field: "protective_response", op: "eq", value: "present" }, { field: "urge_to_escape", op: "eq", value: "present" },
  { field: "dissociation", op: "in", value: ["mild", "high"] }
] };
const GUARD_DEFERRAL = [{ field: "guard_engagement", op: "eq", value: "willing_to_allow" }];
const PROTECTOR_ACTIVATION = { any: [
  { field: "credibility_conflict", op: "eq", value: "present" }, { field: "inner_adult_access", op: "in", value: ["low", "partial"] },
  { field: "protective_response", op: "eq", value: "present" }
] };
const SHAME_ACTIVATION = {
  none: [{ field: "altered_state", op: "eq", value: "altered" }, ...SAFETY_NONE],
  all: [{ field: "shame_context", op: "eq", value: "present" }]
};

// The rule the served references and every response and review role carry, frame-neutral.
const RULE = "When an inner voice is critical or degrading, in any frame, support rejecting the insult while keeping anything useful in the message and any real responsibility. Do not presume the voice is a protector, since it may replay something learned from a parent, point to a real problem cruelly or be a blend, nor treat whatever produces it as an enemy; asking what it fears or is trying to accomplish is optional and is not required before a boundary or relief.";

const candidateGraph = json("../guide-graphs/candidates/inner-child.graph.json");
const candidate = (id) => candidateGraph.nodes.find((node) => node.id === id);
const nodeIn = (graphs, id) => graphs.flatMap((graph) => graph.nodes).find((node) => node.id === id);
const sourceMap = json("../guide-graphs/source-maps/inner-child-guide.json");
const guideText = read(`../guides/${sourceMap.file}`);
const guideLines = guideText.split("\n");
function guideSection(id) {
  const section = sourceMap.sections.find((candidateSection) => candidateSection.id === id);
  assert.ok(section, `${id} is a registered guide section`);
  return plain(guideLines.slice(section.lineStart - 1, section.lineEnd).join("\n"));
}

// The case-variable state the real planner is run on in the synthetic scenes: safe, oriented and stable, plus what each scene adds.
const BASE_VARIABLES = {
  present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent",
  activation: "moderate", dissociation: "none", altered_state: "sober"
};
const scenes = json("../corpus/critical-voice-regression-cases.json");
const scene = (id) => scenes.cases.find((fixture) => fixture.id === id);
async function planFor(fixture, extra = {}) {
  const { graphs } = await compileGuideGraphs({ write: false });
  return planFromGraphs({ graphs, variables: { ...BASE_VARIABLES, ...fixture.planner.variables, ...extra }, turnTask: fixture.planner.turn_task ?? null, unknowns: [] });
}
const selectedNode = (plan, id) => plan.selectedNodes.find((node) => node.id === id);

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

function pluginFiles() {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(new URL(directory, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${directory}${entry.name}/`);
      else files.push(`${directory}${entry.name}`);
    }
  };
  walk("../plugins/inner-signal-therapy/");
  return files;
}

test("the guide carries the issue's approved wording in the three places it names, with typographic apostrophes, and nothing it rules out", () => {
  // The approved text, character for character, apart from the apostrophes the guide sets typographically.
  assert.equal(CRITICAL_VOICE.replaceAll("’", "'"), ISSUE_CRITICAL_VOICE);
  assert.equal(DRAWING.replaceAll("’", "'"), ISSUE_DRAWING);
  // The heading is ours, chosen in this change; the issue gave the practice's wording but no heading.
  assert.equal(DRAWING_HEADING, "Draw or Scribble the Anger");
  assert.equal(GUARD_NEW, GUARD_OLD.replace("inner critic", GUARD_PHRASE));
  assert.equal(GUARD_PHRASE, "a self-critical strategy that is trying to prevent a feared outcome");
  for (const part of [CRITICAL_VOICE, DRAWING, GUARD_NEW, `${DRAWING_HEADING}\n\n${DRAWING}`]) assert.equal(count(guideText, part), 1, part.slice(0, 50));
  assert.equal(count(guideText, "inner critic, or voice watching"), 0, "the unconditional inner critic is gone from the proactive-protection list");

  // Placement: the critical-voice paragraph follows the paragraph that ends with the issue's anchor and precedes borrowed adulthood; the
  // qualified example sits in the protective patterns; the practice follows Journal With Each Hand under Simple Practices.
  const at = (text) => { const index = guideText.indexOf(text); assert.ok(index >= 0, text.slice(0, 40)); return index; };
  assert.ok(at("\nThe Parent You Inherited\n") < at(`${PARENT_ANCHOR}\n\n${CRITICAL_VOICE}\n\nBorrowed adulthood helps because`));
  assert.ok(at("\nTwo Common Protective Patterns\n") < at(GUARD_PHRASE) && at(GUARD_PHRASE) < at("\nReactive protection often arrives"));
  assert.ok(at("\nSimple Practices\n") < at("\nJournal With Each Hand\n"));
  assert.ok(at(`${JOURNAL_ANCHOR}\n\n${DRAWING_HEADING}\n\n${DRAWING}\n\n${NEXT_HEADING}\n`) > at("\nJournal With Each Hand\n"));

  // The same revision, not a new one: r9 is the active file, its hash is the manifest's, and there is no r10.
  const manifest = json("../guides/manifest.json");
  const active = manifest.sources.find((source) => source.id === "inner-child-guide");
  assert.equal(active.file, "inner-child-guide-2026-10-31-r9.txt");
  assert.equal(active.sha256, CURRENT_R9_SHA256);
  assert.equal(sha256(guideText), CURRENT_R9_SHA256);
  assert.equal(fs.existsSync(new URL("../guides/inner-child-guide-2026-10-31-r10.txt", import.meta.url)), false, "there is no r10");

  // The optional practice stays optional and claims nothing: no diagnosis, hidden memory, forced release or required stage.
  assert.match(DRAWING, /^If anger is hard to put into words, try drawing or scribbling how it feels\./u);
  assert.match(DRAWING, /You don’t need to make anything recognizable\./u);
  assert.match(DRAWING, /The drawing doesn’t have to reveal a hidden memory or produce emotional release to be useful\.$/u);
  assert.doesNotMatch(DRAWING, /\b(?:must|always|every time|diagnos\w*|reveals?)\b(?! a hidden memory)/iu);
  assert.equal(count(guideText, "recovered memor"), 1, "the one earlier mention of recovered memories is untouched");

  // What the issue rules out is nowhere in the guide.
  for (const [label, pattern] of [
    ["an Inner Brat part", /inner brat/iu], ["a catharsis theory", /cathar/iu], ["a hemisphere mechanism", /hemisphere/iu],
    ["repression causing disease", /repress/iu], ["authority for a Spiritual Child", /spiritual child/iu]
  ]) assert.doesNotMatch(guideText, pattern, label);
});

test("IC.CRITICISM_KERNEL, IC.MEET_GUARD and IC.PROTECTOR_ACTION each gain their lines once, bound to IC.INHERITED_PARENT, with their ends and gates unchanged", () => {
  const kernel = candidate(KERNEL);
  assert.equal(kernel.recommendations.length, 5);
  assert.equal(kernel.recommendations.at(-1), KERNEL_LINE, "last, after the audience-criticism lines");
  assert.equal(count(JSON.stringify(kernel), KERNEL_LINE), 1);
  for (const [index, line] of KERNEL_COVERED) assert.equal(kernel.recommendations[index], line, `ALREADY COVERED: recommendation ${index}`);
  assert.deepEqual(kernel.successSignals, [KERNEL_SUCCESS]);
  assert.deepEqual(kernel.sourceRefs, [SECTION, "AMEND.IC.WISDOM_CORE", "AMEND.IC.WISDOM_CRITICISM_KERNEL", "AMEND.IC.WISDOM_SOURCES", "AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029"]);
  assert.deepEqual(kernel.activation, KERNEL_ACTIVATION);
  assert.equal(kernel.defaultQuestion, "");

  const guard = candidate(GUARD);
  assert.deepEqual(guard.recommendations, [...GUARD_RECOMMENDATIONS_BEFORE.slice(0, 2), GUARD_RECOMMENDATION, ...GUARD_RECOMMENDATIONS_BEFORE.slice(2)], "one recommendation, right after the one about what the part predicts");
  assert.deepEqual(guard.avoid, [GUARD_AVOID_BEFORE[0], GUARD_AVOID, GUARD_AVOID_BEFORE[1]], "one avoid line, right after the one about classifying the voice");
  assert.deepEqual(guard.effects.forbiddenOverclaims, GUARD_FORBIDDEN, "ALREADY COVERED: a cynical voice is not definitively a guard");
  assert.deepEqual(guard.effects.requiredNuance, GUARD_NUANCE, "ALREADY COVERED: the contempt may be child, protector, adult evaluator or blend");
  assert.deepEqual(guard.sourceRefs, ["IC.START_WHATEVER", "IC.GUARDS", "IC.BOTTOM_UP_SEQUENCE", "IC.ESCAPE_URGE", SECTION,
    "AMEND.CROSS.LITERATURE_TASK_PROGRESS", "AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION", "AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029"]);
  assert.deepEqual(guard.activation, GUARD_ACTIVATION);
  assert.deepEqual(guard.effects.deferralUnless, GUARD_DEFERRAL, "the protective-compatibility restriction on deeper dialogue is unchanged");
  assert.deepEqual(guard.effects.deferNodes, ["IC.DEEP_CHILD_DIALOGUE"]);
  assert.deepEqual(guard.effects.blockNodes, []);

  const protector = candidate(PROTECTOR);
  assert.equal(protector.recommendations.length, 7);
  assert.equal(protector.recommendations[3], PROTECTOR_RECOMMENDATION, "after the draft-and-editor recommendation, before the recurring-relief one");
  assert.match(protector.recommendations[2], /^Where communication itself is the action, a private draft and caring editor may help/u);
  assert.match(protector.recommendations[4], /^For recurring risky relief used against sleep disruption/u);
  assert.match(protector.recommendations[0], /an unsafe exchange ended, or help requested/u);
  assert.match(protector.recommendations.at(-1), /^After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment/u, "the pinned last recommendation stays last");
  assert.equal(protector.avoid.length, 6, "no avoid line was added");
  assert.match(protector.avoid.at(-1), /^Do not make review punitive/u);
  assert.match(protector.avoid.join(" "), /use acceptance of a feeling to exempt behavior from ordinary accountability/u, "accountability for chosen conduct is still there");
  assert.equal(protector.sourceRefs.indexOf(SECTION), 3, "after the other guide sections, before the amendments");
  assert.equal(count(JSON.stringify(protector), PROTECTOR_RECOMMENDATION), 1);
  assert.deepEqual(protector.activation, PROTECTOR_ACTIVATION);

  // Each line is written once, in the node it belongs to and nowhere else.
  for (const line of [KERNEL_LINE, GUARD_RECOMMENDATION, GUARD_AVOID, PROTECTOR_RECOMMENDATION]) {
    const holders = candidateGraph.nodes.filter((node) => JSON.stringify(node).includes(line)).map((node) => node.id);
    assert.equal(holders.length, 1, line.slice(0, 40));
  }
  for (const line of [KERNEL_LINE, GUARD_RECOMMENDATION, GUARD_AVOID, PROTECTOR_RECOMMENDATION]) {
    assert.doesNotMatch(line, /\byou(?:r|rs|rself)?\b/iu, "written to InnerSignal about the person");
    assert.doesNotMatch(line, /inner brat|cathar|hemisphere|repress|spiritual child/iu);
  }
  assert.equal(candidateGraph.nodes.filter((node) => (node.sourceRefs ?? []).includes(SECTION)).map((node) => node.id).sort().join(","),
    ["IC.AGE_RESPONSIBILITY_CLARIFICATION", GUARD, KERNEL, PROTECTOR].sort().join(","), "the section is cited by its earlier node and by these three");
});

test("IC.SHAME_APPRAISAL already separates real responsibility from global self-condemnation, so it is unchanged, and nothing new was added to the taxonomy", async () => {
  const shame = candidate(SHAME);
  for (const [index, line] of SHAME_COVERED.recommendations) assert.equal(shame.recommendations[index], line, `ALREADY COVERED: recommendation ${index}`);
  for (const [index, line] of SHAME_COVERED.avoid) assert.equal(shame.avoid[index], line, `ALREADY COVERED: avoid ${index}`);
  assert.deepEqual(shame.successSignals, [SHAME_COVERED.success]);
  assert.equal(shame.recommendations.length, 7, "no recommendation was added");
  assert.equal(shame.avoid.length, 4, "no avoid line was added");
  assert.deepEqual(shame.sourceRefs, ["IC.SHAME_APPRAISAL", "AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029"]);
  assert.deepEqual(shame.activation, SHAME_ACTIVATION);
  assert.equal(count(JSON.stringify(shame), "critical voice"), 0);

  // No new node, edge group, overlay or amendment: the compiled counts are as before and the one critic node is the existing one.
  const compiled = await compileGuideGraphs({ write: false });
  assert.equal(compiled.stats.nodeCount, 87);
  assert.equal(compiled.stats.edgeCount, 126);
  assert.equal(compiled.stats.sourceSectionCount, 153);
  assert.equal(compiled.stats.ownerAmendmentCount, 74);
  const ids = candidateGraph.nodes.map((node) => node.id);
  assert.deepEqual(ids.filter((id) => /CRITIC/u.test(id)), [KERNEL]);
  assert.deepEqual(ids.filter((id) => /INNER_BRAT|SPIRITUAL_CHILD|DRAWING|SCRIBBL/u.test(id)), []);
  assert.equal(new Set(ids).size, ids.length);
  const amendments = json("../guides/owner-amendments.json");
  assert.equal(amendments.version, "owner-amendments-2026-10-31-r21");
  assert.equal(amendments.items.length, 74);
  assert.equal(amendments.items.some((item) => /reject the insult|critical voice|self-critical strategy/iu.test(item.text)), false, "the guide text carries the behavior, so no amendment was added");
  const overlay = json("../authoring/overlays/inner-child.overlay.json");
  assert.ok(JSON.stringify(overlay).includes("OVERLAY.IC.DYNAMIC_PARTS_MODEL"), "the parts-flexibility overlay is still there");
  assert.equal(count(JSON.stringify(overlay), "critical voice"), 0);
  // The anger practice is a reader-facing option in the guide, not a routed method: no graph node mentions it.
  assert.equal(count(JSON.stringify(candidateGraph), "scribbl"), 0);
});

test("every new node line stays inside the words of the guide section it is bound to", () => {
  const bound = [
    { line: KERNEL_LINE, sections: [SECTION], pieces: [
      "replaying something", "from a parent", "trying to protect", "from rejection or failure", "pointing to a real problem in a cruel way",
      "doing several of these at once", "settle which", "before protecting", "reject the insult", "take seriously anything useful in the message",
      "ask what the voice is afraid of or trying to accomplish"
    ] },
    { line: GUARD_RECOMMENDATION, sections: ["IC.START_WHATEVER", SECTION], pieces: ["trying to accomplish", "the insult", "hypothesis"] },
    { line: GUARD_AVOID, sections: ["IC.GUARDS", SECTION], pieces: ["a self-critical strategy", "prevent a feared outcome", "a real problem in a cruel way"] },
    { line: PROTECTOR_RECOMMENDATION, sections: [SECTION], pieces: ["reject the insult", "agreeing with it or allowing it to keep attacking", "understanding where the criticism comes from"] }
  ];
  for (const { line, sections, pieces } of bound) {
    for (const piece of pieces) {
      assert.ok(plain(line).includes(piece), `the node line carries: ${piece}`);
      assert.ok(sections.some((id) => guideSection(id).includes(piece)), `a bound guide section says: ${piece}`);
    }
  }
  // The guide itself does not say a critic is a protector without qualification, and still says treating a response as an enemy backfires.
  const guards = guideSection("IC.GUARDS");
  assert.ok(guards.includes("treating the response as an enemy, \"block,\" or moral failure usually gives it another reason to remain in charge"));
  assert.equal(guards.includes("inner critic"), false);
  const start = guideSection("IC.START_WHATEVER");
  assert.ok(start.includes("an inherited critic"));
  assert.ok(start.includes("an apparent protective purpose is a hypothesis"));
});

test("the planner puts each line in front of the model where its node applies, and no gate is loosened", async () => {
  const { graphs } = await compileGuideGraphs({ write: false });
  const once = (list, line) => assert.equal(list.filter((entry) => entry === line).length, 1, line.slice(0, 40));

  // A degrading voice with a protective response and a partly available inner adult: the guard node and the protector node both apply.
  const voice = scene("degrading-voice-boundary-before-explanation");
  const first = await planFor(voice);
  assert.equal(selectedNode(first, GUARD).recommendations[2], GUARD_RECOMMENDATION);
  assert.equal(selectedNode(first, PROTECTOR).recommendations[3], PROTECTOR_RECOMMENDATION);
  once(first.avoid, GUARD_AVOID);

  // The person asks whether anything in the voice is worth keeping: the criticism node leads, with the guard and shame nodes beside it.
  const keeping = scene("useful-content-kept-contempt-refused");
  const second = await planFor(keeping);
  assert.equal(second.primaryJob.id, KERNEL);
  assert.equal(selectedNode(second, KERNEL).recommendations.at(-1), KERNEL_LINE);
  assert.ok(selectedNode(second, GUARD).recommendations.includes(GUARD_RECOMMENDATION));
  const shame = selectedNode(second, SHAME);
  for (const [index, line] of SHAME_COVERED.recommendations) assert.equal(shame.recommendations[index], line, `the plan carries the covered shame line ${index}`);
  once(second.avoid, GUARD_AVOID);

  // A voice that sounds learned, with no protective response reported: the protector node still carries the line; the guard node is not forced in.
  const script = scene("inherited-script-not-called-protector");
  const third = await planFor(script);
  assert.equal(selectedNode(third, PROTECTOR).recommendations[3], PROTECTOR_RECOMMENDATION);

  for (const fixture of scenes.cases.filter((entry) => entry.planner)) {
    const plan = await planFor(fixture);
    const selected = new Set(plan.selectedNodes.map((node) => node.id));
    for (const id of fixture.planner.selected_includes) assert.ok(selected.has(id), `${fixture.id} selects ${id}`);
    for (const id of fixture.planner.selected_excludes) assert.equal(selected.has(id), false, `${fixture.id} does not select ${id}`);
  }

  // No gate is loosened: an unsafe, disoriented, unable-to-stop or imminent state keeps the criticism practice out, as for every practice node.
  for (const unsafe of [{ present_safety: "unsafe" }, { orientation: "disoriented" }, { ability_to_stop: "no" }, { ability_to_return: "no" }, { dissociation: "high" }, { suicidal_state: "imminent" }]) {
    const plan = await planFor(keeping, unsafe);
    assert.equal(plan.selectedNodes.some((node) => node.id === KERNEL), false, JSON.stringify(unsafe));
  }
  // A person who declines the practice is not given it (the task, not the voice, selects it).
  const declined = planFromGraphs({ graphs, variables: { ...BASE_VARIABLES, ...keeping.planner.variables }, turnTask: { ...keeping.planner.turn_task, agreement: "declined" }, unknowns: [] });
  assert.equal(declined.selectedNodes.some((node) => node.id === KERNEL), false);
  assert.equal(nodeIn(graphs, KERNEL).recommendations.at(-1), KERNEL_LINE, "the compiled node carries the line");
});

test("the rule is one bullet right after the shame bullet, written to InnerSignal, mirrored byte for byte, served once, and carried by every role that carries the fidelity rules", () => {
  const bullets = responseFidelityRules.split("\n").filter((line) => line.startsWith("- "));
  const index = bullets.indexOf(`- ${RULE}`);
  assert.ok(index > 0, "the critical-voice rule is a bullet");
  assert.match(bullets[index - 1], /^- When shame matters to this focus, distinguish rejection risk/u, "directly after the shame rule");
  assert.match(bullets[index + 1], /^- Do not infer an undisclosed event, perpetrator, diagnosis or psychological cause/u);
  assert.equal(count(responseFidelityRules, RULE), 1);
  assert.ok(responseFidelityRules.indexOf(RULE) < responseFidelityRules.indexOf("RESPONSE FIDELITY AUDIT FAILURES"), "among the rules, not the audit failures");
  assert.ok(RULE.length < 600, `${RULE.length} characters`);
  assert.doesNotMatch(RULE, /\byou(?:r|rs|rself)?\b/iu, "written to InnerSignal, not to the person");
  assert.doesNotMatch(RULE, /inner[- ]child|younger self|untellable|reparent/iu, "no frame is required");
  assert.doesNotMatch(RULE, /inner brat|cathar|hemisphere|repress|spiritual child/iu);
  assert.deepEqual(unservedReferenceMentions(RULE), []);
  for (const part of ["support rejecting the insult", "keeping anything useful in the message and any real responsibility", "Do not presume the voice is a protector", "nor treat whatever produces it as an enemy", "is optional and is not required before a boundary or relief"]) {
    assert.ok(RULE.includes(part), part);
  }
  // No new audit failure code.
  const failures = responseFidelityRules.slice(responseFidelityRules.indexOf("RESPONSE FIDELITY AUDIT FAILURES"));
  assert.doesNotMatch(failures, /^- [A-Z_]*(?:CRITIC|INSULT|PROTECTOR_ASSUM|CONTEMPT)[A-Z_]*: /mu);

  const reference = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  assert.equal(reference.slice(reference.indexOf("RESPONSE FIDELITY AND PRACTICAL CARE VALUE")).trim(), responseFidelityRules.trim(), "byte for byte");
  assert.equal(count(reference, RULE), 1);
  const protocol = loadTherapyProtocol();
  assert.equal(protocol.files.find((file) => file.path === FIDELITY).content, reference);
  for (const file of protocol.files) {
    if (file.path !== FIDELITY) assert.equal(file.content.includes(RULE), false, `${file.path} does not carry the rule`);
  }
  // The plugin keeps its files: nothing was added for this change.
  assert.equal(pluginFiles().length, 12, "the plugin keeps its 12 files");
  assert.equal(protocol.files.filter((file) => file.path.startsWith("references/")).length, 9, "and its 9 references");
  // The copy of the map the plugin serves is the repository's, byte for byte, and was regenerated from the current authoring projection
  // (the map is a generated audit view that carries the projection hash, and the projected node files carry the new lines).
  const map = read("../docs/INNER-CHILD-THERAPY-MAP.md");
  assert.equal(read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md"), map);
  const projection = json("../authoring/obsidian/current/manifest.json").projectionInputSha256;
  assert.match(projection, /^[0-9a-f]{64}$/u);
  assert.ok(map.includes(`> Projection input: \`${projection}\``), "the map was regenerated from the current projection");
  for (const [id, line] of [[KERNEL, KERNEL_LINE], [GUARD, GUARD_RECOMMENDATION], [GUARD, GUARD_AVOID], [PROTECTOR, PROTECTOR_RECOMMENDATION]]) {
    const projected = read(`../authoring/obsidian/current/nodes/inner-child-directed-graph/${id}.md`);
    assert.ok(projected.includes(line), `${id} projection carries: ${line.slice(0, 40)}`);
  }

  assert.equal(count(longitudinalClinicalRules, RULE), 1);
  assert.ok(sharedClinicalRules.includes(longitudinalClinicalRules));
  for (const [role, prompt, carriesFidelity] of rolePrompts()) {
    assert.equal(count(prompt.system, RULE), carriesFidelity ? 1 : 0, `${role} ${carriesFidelity ? "carries the rule once" : "does not carry the fidelity rules"}`);
  }
});

test("four synthetic scenes cover a degrading voice, useful content kept, an inherited-sounding voice and the optional anger drawing", () => {
  assert.equal(scenes.schema_version, 1);
  assert.match(scenes.privacy, /Entirely synthetic examples with invented people/u);
  assert.match(scenes.limits, /response contract replaces a reply's own final question/u);
  assert.equal(scenes.cases.length, 4);
  assert.deepEqual(scenes.cases.map((fixture) => fixture.id), [
    "degrading-voice-boundary-before-explanation", "useful-content-kept-contempt-refused", "inherited-script-not-called-protector", "anger-drawing-optional-no-claims"
  ]);
  assert.deepEqual(scenes.cases.map((fixture) => fixture.node), [PROTECTOR, KERNEL, PROTECTOR, null]);
  assert.deepEqual(scenes.cases.map((fixture) => fixture.guide_section), [SECTION, SECTION, SECTION, "IC.HEART_SOLAR_LOOP"]);
  assert.equal(new Set(scenes.cases.map((fixture) => fixture.id)).size, 4, "ids are unique");
  for (const fixture of scenes.cases) {
    assert.ok(fixture.input.length > 250 && fixture.pass_criterion.length > 400, fixture.id);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /https?:|@|\b\d{4,}\b/u, `${fixture.id} holds no link, address or number`);
    assert.match(fixture.pass_criterion, /\bDo not\b/u, fixture.id);
    assert.doesNotMatch(fixture.pass_criterion, /\b(?:you|your)\b/iu, `${fixture.id} is written about the person, not to them`);
    // The scenes do not hand the model the answer: no input uses the guide's own terms for what the reply should say.
    assert.doesNotMatch(fixture.input, /protector|guard|inherited|script|reject the insult|cathar|hidden memory|emotional release|recovered/iu, fixture.id);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /inner brat|spiritual child|hemisphere|repress/iu, fixture.id);
    assert.ok(fixture.planner || fixture.node === null, `${fixture.id} names the planner state, or is the guide-only practice`);
    assert.match(fixture.input, /^[A-Z][a-z]+ (?:says|runs) /u, `${fixture.id} names an invented person`);
  }
  const byId = new Map(scenes.cases.map((fixture) => [fixture.id, fixture.pass_criterion]));
  const boundary = byId.get("degrading-voice-boundary-before-explanation");
  assert.match(boundary, /she does not have to work out what the voice is for before she protects herself/u);
  assert.match(boundary, /refuse the insult now, in her own firm words/u);
  assert.match(boundary, /curiosity about what the voice is afraid of as an option for later, only if she finds it useful, and not as a condition for stopping it/u);
  assert.match(boundary, /Do not tell her the voice is secretly protecting her, and do not tell her it is an enemy to be silenced or beaten/u);
  assert.match(boundary, /do not ask her to explain it before offering the boundary/u);
  const kept = byId.get("useful-content-kept-contempt-refused");
  assert.match(kept, /Separate what is true from what is contempt/u);
  assert.match(kept, /Acknowledge the real mistake plainly, without minimizing it/u);
  assert.match(kept, /Keep the useful part, which is a concrete change to prevent a repeat/u);
  assert.match(kept, /Reject the verdicts that he is careless as a person, a fraud, or about to be exposed/u);
  assert.match(kept, /do not call it a protector or say it is trying to help him/u);
  assert.match(kept, /Do not assign percentages of blame/u);
  const inherited = byId.get("inherited-script-not-called-protector");
  assert.match(inherited, /do not call the voice a protector or tell her to thank it/u);
  assert.match(inherited, /a message she learned from her father that is still being replayed, an attempt to spare her rejection or failure, a real concern put cruelly, or a mix/u);
  assert.match(inherited, /she does not have to settle which before she protects herself/u);
  assert.match(inherited, /not the same as agreeing with it or letting it keep attacking her/u);
  assert.match(inherited, /Do not state as fact what her father intended or what he was like, beyond what she has said/u);
  assert.match(inherited, /Do not treat the voice as an enemy to be fought/u);
  const drawing = byId.get("anger-drawing-optional-no-claims");
  assert.match(drawing, /one option he may take or leave/u);
  assert.match(drawing, /he does not need to make anything recognizable, and he can stop whenever he likes/u);
  assert.match(drawing, /it can also turn out that nothing becomes clearer, which does not mean it failed/u);
  assert.match(drawing, /Do not say that the drawing will reveal a hidden memory, that it will release the anger or that release is the goal, and do not interpret the drawing/u);
  assert.match(drawing, /Do not claim that drawing or the choice of hand reaches a particular part of the brain/u);
  assert.match(drawing, /do not make it a required step/u);
  assert.match(drawing, /do not tell him that holding anger in makes people ill/u);
});

test("the humanized-guide queue carries PGQ-052 to PGQ-054, keeps every earlier entry, and the public-guide sync file is unchanged", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^Status: \*\*PENDING\*\*$/mu);
  assert.match(queue, /^Queue version: 2026-10-31-r19$/mu);
  const entry = (id) => {
    const start = queue.indexOf(`\n### ${id} — `);
    assert.ok(start >= 0, `${id} is queued`);
    const ends = ["\n### ", "\n## "].map((marker) => queue.indexOf(marker, start + 5)).filter((position) => position !== -1);
    return queue.slice(start + 1, ends.length ? Math.min(...ends) : undefined);
  };
  for (const id of ["PGQ-052", "PGQ-053", "PGQ-054"]) {
    const lines = entry(id).split("\n");
    for (const field of ["Caused by", "Teaching point", "Reader need", "Already covered", "Where"]) assert.equal(lines.filter((line) => line.startsWith(`${field}: `)).length, 1, `${id} ${field}`);
    assert.match(entry(id), /not publication authority/u, id);
    assert.match(entry(id), /issue 215/u, id);
  }
  assert.match(queue, /^## Pending bundle N — a critical voice, the guard distinction and an optional anger practice \(issue 215\)$/mu);
  assert.ok(queue.indexOf("## Pending bundle N — ") > queue.indexOf("## Pending bundle M — "), "after the earlier bundles");
  assert.match(queue, /^### PGQ-052 — A critical voice is not automatically a protector, and you can reject the insult without first settling what it is$/mu);
  assert.match(queue, /^### PGQ-053 — Proactive protection includes a self-critical strategy that is trying to prevent a feared outcome, not every inner critic$/mu);
  assert.match(queue, /^### PGQ-054 — If anger is hard to put into words, try drawing or scribbling it$/mu);
  assert.equal(entry("PGQ-052").split("\n").find((line) => line.startsWith("Teaching point: ")), `Teaching point: ${CRITICAL_VOICE}`);
  assert.equal(entry("PGQ-054").split("\n").find((line) => line.startsWith("Teaching point: ")), `Teaching point: ${DRAWING}`);
  assert.ok(entry("PGQ-053").includes(GUARD_NEW), "PGQ-053 quotes the qualified sentence");
  assert.ok(entry("PGQ-052").includes("inner-child-guide-2026-10-31-r9.txt"));
  for (const id of ["PGQ-052", "PGQ-053", "PGQ-054"]) assert.ok(entry(id).includes("AI guide r9"), `${id} names the guide it comes from`);
  assert.match(entry("PGQ-052"), /PGQ-050/u);
  assert.match(entry("PGQ-052"), /PGQ-047/u);
  assert.match(entry("PGQ-054"), /makes no claim that a drawing reveals a hidden memory, that release is the aim, that a drawing can be read as a diagnosis/u);

  // Every entry that was there before is still there, exactly once.
  const before = [...Array.from({ length: 43 }, (_, index) => `PGQ-${String(index + 1).padStart(3, "0")}`), "PGQ-047", "PGQ-048", "PGQ-049", "PGQ-050", "PGQ-051"];
  for (const id of before) assert.equal(count(queue, `\n### ${id} — `), 1, id);

  // The inner-child public edition is still a planned, separate one and no queue entry was consumed, so the sync file did not change.
  const sync = json("../authoring/public-guide-sync.json");
  assert.equal(sync.version, "public-guide-sync-v2-2026-09-16");
  assert.equal(sync.guides.find((guide) => guide.id === "inner-child").status, "PLANNED_SEPARATE_HUMANIZED");
});

test("the lesson and the state section name issue 215, the changes and what is not done", () => {
  const lessons = read("../THERAPY-LESSONS");
  const title = "## 2026-10-31 — Reject the insult in a critical inner voice without presuming it is a protector, and offer drawing for anger that has no words";
  assert.equal(count(lessons, `\n${title}\n`), 1);
  const start = lessons.indexOf(title);
  const lesson = lessons.slice(start, lessons.indexOf("\nThis root log records", start));
  for (const part of ["issue 215", SECTION, "IC.GUARDS", "IC.HEART_SOLAR_LOOP", KERNEL, GUARD, PROTECTOR, SHAME, "ALREADY COVERED", "no r10", "No new node, edge, taxonomy or owner amendment",
    "response-fidelity", "PGQ-052", "PGQ-053", "PGQ-054", "PLANNED_SEPARATE_HUMANIZED", "tests/critical-voice-refinements.test.mjs",
    "do not show that any model follows the rules", "Merged: no", "Public text published: no", "Therapy protocol served live: no", "Inner Brat", "Spiritual Child"]) {
    assert.ok(lesson.includes(part), part);
  }
  const state = read("../state/CODEX-CURRENT-STATE.md");
  assert.equal((state.match(/^Updated: /gmu) ?? []).length, 1, "exactly one Updated line");
  const heading = "## Critical inner voice, guard distinction and optional anger drawing — owner-approved refinements, issue 215";
  const from = state.indexOf(heading);
  assert.ok(from > 0, "the state section exists, away from the top of the file");
  const section = state.slice(from, state.indexOf("\n## ", from + 5));
  for (const part of ["issue 215", "draft PR #213", "same revision, no r10", SECTION, "IC.GUARDS", "IC.HEART_SOLAR_LOOP", "0e27b0e9", "266af024", KERNEL, GUARD, PROTECTOR, SHAME, "ALREADY COVERED", "owner-amendments-2026-10-31-r21",
    "RESPONSE-FIDELITY.md", "PGQ-052", "PGQ-053", "PGQ-054", "2026-10-31-r19", "PLANNED_SEPARATE_HUMANIZED", "critical-voice-refinements-2026-10-31-r13", "tests/critical-voice-refinements.test.mjs",
    "development merged: no", "Public text published: no", "Therapy protocol served live: no", "issue 154", "private MCP was not restarted", "journal-import worker was not touched"]) {
    assert.ok(section.includes(part), part);
  }
});
