import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { focusDisciplineRules } from "../src/prompts/focus-discipline.mjs";
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
import { loadTherapyProtocol, unservedReferenceMentions } from "../src/protocol/therapy-protocol.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { runGraphRegressionSuite } from "../src/guide-graph/regressions.mjs";
import { withoutIssue215, QUESTION_51_R9_SHA256 } from "./fixtures/issue-215-guide-edits.mjs";

// Owner answer of 31 October 2026 (question 51, option A) to a de-identified lesson from the architecture repository's
// suggested-fix lane: once the sequence of a painful disagreement is known well enough, compare what the person was trying to
// achieve, the reaction they realistically anticipated and how they now judge their manner and what followed, then choose the
// next step. Every example is synthetic. These static tests show where the rule is written, served, wired and bound, and that the
// plan's routes adapt to what remains to be done; they do not show that a model follows the rules.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const AMENDMENT = "AMEND.CROSS.RELATIONAL_INTENTION_EXPECTATION_APPRAISAL_20261031";
const SEQUENCE_AMENDMENT = "AMEND.CROSS.RELATIONAL_SEQUENCE_BOTH_SIDES_20261028";
const NODE = "ROUTE.RELATIONAL_REALITY_CHECK";
// The route's own question is the sequence question from the earlier change; this change does not touch it.
const QUESTION = "What did each of you actually say and do, in order, and what has this person shown they can do when you disagree, say no, or ask for repair?";
const FOCUS = "references/FOCUS-DISCIPLINE.md";
const FIDELITY = "references/RESPONSE-FIDELITY.md";
const SEQUENCE_BULLET = "- When a client describes wanting acceptance, then a disagreement or confrontation, then rejection, recover the missing middle before interpreting it:";
const FOCUS_BULLET_START = "- After a painful disagreement whose sequence of what each person said and did is known well enough, review the completed encounter before choosing a next step.";
const FIDELITY_BULLET = "- Closely related questions may form one coherent inquiry when they serve the same decision: weigh the value of the answers against the load on the person rather than counting question marks, keep one primary next move, and defer low-value subsidiary questions. This does not make several questions the default; one question is still right when it is enough.";
// Clauses the focus rule, the amendment and the route recommendation share word for word, apart from "client" and "person".
const SHARED_CLAUSES = [
  " was trying to achieve by communicating, the reaction they realistically anticipated at the time, including surprise or a foreseeable tradeoff, and how they now judge both their manner and what followed, then compare the three.",
  "This is not the same as defining a realistic outcome for a future interaction.",
  "Do not assume regret, fault, satisfaction, a wish to reconcile or a fixed character:",
  " can stand by a position, regret the wording and grieve the loss at once.",
  "The next step may be communication repair, a boundary, a decision about relational fit or optional developmental work.",
  "Once that sequence is known, stop asking for incident detail unless the missing detail would change the next step or safety.",
  " hoped for, do not ask only that; the more useful questions are usually whether they expected the reaction and how they judge their choice now.",
  "This is not a requirement to ask all three every time.",
  "Where threats or intimidation are actually supported, keep the existing safety and accountability distinctions, and do not treat the more powerful or threatening party and the threatened party as equally responsible."
];
// The owner's two guide sentences (question 51, option A) and the r8 sentence they follow.
const ANCHOR = "Before deciding what someone's reaction to a disagreement means, go back over what each of you actually said and did, in order.";
const ADDITION = "After a painful disagreement, ask what you were trying to achieve, what response you expected, and how you now feel about what you said and what followed. You can stand by your convictions and still wish you had expressed them differently; you may also accept an unavoidable consequence without regretting your choice.";
const NEXT_STEPS = ["communication repair", "a boundary", "a decision about relational fit", "optional developmental work", "safety and accountability handling", "one coherent inquiry"];

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

function sourceFilesMentioning(text) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(new URL(directory, import.meta.url), { withFileTypes: true })) {
      const relative = `${directory}${entry.name}`;
      if (entry.isDirectory()) walk(`${relative}/`);
      else if (/\.(?:mjs|js)$/u.test(entry.name) && read(relative).includes(text)) found.push(relative);
    }
  };
  walk("../src/");
  return found;
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

test("the focus rule is one bullet, written to InnerSignal, and carries every clause of the amendment", () => {
  const bullets = focusDisciplineRules.split("\n").filter((line) => line.startsWith(FOCUS_BULLET_START));
  assert.equal(bullets.length, 1, "one bullet");
  const [bullet] = bullets;
  for (const clause of SHARED_CLAUSES) assert.ok(bullet.includes(clause), clause);
  assert.ok(bullet.includes("Distinguish what the client was trying to achieve by communicating"));
  assert.ok(bullet.includes("a client can stand by a position"));
  assert.ok(bullet.includes("When context already suggests what the client hoped for"));
  // It addresses InnerSignal about "the client"; it never speaks to the client as "you".
  assert.doesNotMatch(bullet, /\byou(?:r|rs|rself)?\b/iu);
  assert.deepEqual(unservedReferenceMentions(bullet), []);
  // It sits in the focus block, whose version label and opening rule are unchanged, beside the earlier missing-middle rule.
  assert.match(focusDisciplineRules, /^\nFOCUS DISCIPLINE \(focus-discipline-v1\)\n- The therapist keeps the session on point\./u);
  assert.equal(count(focusDisciplineRules, SEQUENCE_BULLET), 1, "the earlier missing-middle rule is still there once");
  assert.ok(focusDisciplineRules.indexOf(FOCUS_BULLET_START) > focusDisciplineRules.indexOf(SEQUENCE_BULLET), "the review follows the recovery of the sequence");
});

test("the served references end with the module text byte for byte, and each bullet is served only where it belongs", () => {
  const focusReference = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/FOCUS-DISCIPLINE.md");
  assert.ok(focusReference.endsWith(focusDisciplineRules), "focus: byte for byte");
  const fidelityReference = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  assert.equal(fidelityReference.slice(fidelityReference.indexOf("RESPONSE FIDELITY AND PRACTICAL CARE VALUE")).trim(), responseFidelityRules.trim(), "fidelity: byte for byte");
  const protocol = loadTherapyProtocol();
  assert.equal(protocol.files.find((file) => file.path === FOCUS).content, focusReference);
  assert.equal(protocol.files.find((file) => file.path === FIDELITY).content, fidelityReference);
  assert.equal(count(focusReference, FOCUS_BULLET_START), 1);
  assert.equal(count(fidelityReference, FIDELITY_BULLET), 1);
  for (const file of protocol.files) {
    if (file.path !== FOCUS) assert.equal(file.content.includes(FOCUS_BULLET_START), false, `${file.path} does not carry the focus bullet`);
    if (file.path !== FIDELITY) assert.equal(file.content.includes(FIDELITY_BULLET), false, `${file.path} does not carry the question-selection bullet`);
  }
  // The plugin keeps the same files and references: nothing was added for this change.
  assert.equal(pluginFiles().length, 12, "the plugin keeps its 12 files");
  assert.equal(protocol.files.filter((file) => file.path.startsWith("references/")).length, 9, "and its 9 references");
});

test("the question-selection rule says what the lesson asks, in the existing response-fidelity list, with no new audit failure", () => {
  assert.equal(count(responseFidelityRules, FIDELITY_BULLET), 1);
  const lines = responseFidelityRules.split("\n");
  const index = lines.indexOf(FIDELITY_BULLET);
  assert.ok(index > 0);
  // It sits directly after the rule that a question earns its place by how its answers could change the step, and before the rule
  // on trimming, so the discipline of one question with decision value is read first and this adds its bounded exception.
  assert.match(lines[index - 1], /^- Before choosing a substantive question, identify how plausible answers could change the current therapeutic step/u);
  assert.match(lines[index - 1], /Prefer one question with decision value\./u);
  assert.match(lines[index + 1], /^- After checking meaning and safety, remove sentences that repeat earlier points/u);
  for (const clause of ["serve the same decision", "weigh the value of the answers against the load on the person rather than counting question marks", "keep one primary next move", "defer low-value subsidiary questions", "does not make several questions the default"]) {
    assert.ok(FIDELITY_BULLET.includes(clause), clause);
  }
  assert.doesNotMatch(FIDELITY_BULLET, /\byou(?:r|rs|rself)?\b/iu);
  // No new evaluator and no new audit failure code: the audit-failure list holds nothing about intention, expectation or appraisal.
  const failures = responseFidelityRules.slice(responseFidelityRules.indexOf("RESPONSE FIDELITY AUDIT FAILURES"));
  assert.doesNotMatch(failures, /^- [A-Z_]*(?:INTENTION|EXPECTATION|APPRAISAL|RETROSPECT)[A-Z_]*: /mu);
  assert.equal(count(failures, "\n- MISSING_MIDDLE_INTERPRETATION: "), 1, "the earlier audit failure is untouched");
});

test("no new evaluator: the bullets live only in their own modules and reach the existing review roles", () => {
  assert.deepEqual(sourceFilesMentioning(FOCUS_BULLET_START), ["../src/prompts/focus-discipline.mjs"]);
  assert.deepEqual(sourceFilesMentioning("Closely related questions may form one coherent inquiry"), ["../src/prompts/response-fidelity.mjs"]);
  assert.equal(count(longitudinalClinicalRules, FIDELITY_BULLET), 1);
  assert.ok(sharedClinicalRules.includes(longitudinalClinicalRules));
  for (const [role, prompt, carriesFidelity] of rolePrompts()) {
    assert.equal(count(prompt.system, FOCUS_BULLET_START), 1, `${role} carries the focus bullet once`);
    assert.equal(count(prompt.system, FIDELITY_BULLET), carriesFidelity ? 1 : 0, `${role} ${carriesFidelity ? "carries the question-selection bullet once" : "does not carry the fidelity rules"}`);
  }
});

test("the owner amendment is approved, versioned with the manifest, and says what the rule says", () => {
  const amendments = json("../guides/owner-amendments.json");
  const manifest = json("../guides/manifest.json");
  assert.match(amendments.version, /^owner-amendments-\d{4}-\d{2}-\d{2}-r\d+$/u);
  assert.equal(manifest.sources.find((source) => source.id === "owner-amendments").version, amendments.version);
  assert.equal(new Set(amendments.items.map((entry) => entry.id)).size, amendments.items.length, "ids are unique");
  const item = amendments.items.find((entry) => entry.id === AMENDMENT);
  assert.equal(item?.status, "owner-approved");
  assert.equal(item.domain, "cross-guide");
  assert.equal(item.approvedAt, "2026-10-31");
  assert.equal(amendments.items.filter((entry) => entry.id === AMENDMENT).length, 1, "recorded once");
  assert.match(item.text, /^After a painful disagreement whose sequence of what each person said and did is known well enough, review the completed encounter before choosing a next step\./u);
  for (const clause of SHARED_CLAUSES) assert.ok(item.text.includes(clause), clause);
  assert.ok(item.text.includes("Distinguish what the person was trying to achieve by communicating"));
  assert.ok(item.text.includes("a person can stand by a position"));
  assert.ok(item.text.includes("When context already suggests what the person hoped for"));
  // Written to InnerSignal about "the person", never to the client as "you".
  assert.doesNotMatch(item.text, /\byou(?:r|rs|rself)?\b/iu);
  // The earlier sequence amendment is still there, once and unchanged in its opening.
  const earlier = amendments.items.find((entry) => entry.id === SEQUENCE_AMENDMENT);
  assert.equal(earlier?.status, "owner-approved");
  assert.equal(earlier.approvedAt, "2026-10-28");
  assert.match(earlier.text, /^When a person describes wanting acceptance, then a disagreement or confrontation, then rejection, recover the missing middle before interpreting it:/u);
});

test("the amendment extends the existing reality check once, with no duplicate node, and the compiled graph agrees", async () => {
  const graph = json("../guide-graphs/candidates/cross-guide.graph.json");
  const node = graph.nodes.find((candidate) => candidate.id === NODE);
  assert.ok(node.sourceRefs.includes(AMENDMENT));
  assert.equal(node.sourceRefs.filter((ref) => ref === AMENDMENT).length, 1, "bound once");
  assert.ok(node.sourceRefs.includes(SEQUENCE_AMENDMENT), "the earlier amendment stays bound");
  const everyNode = fs.readdirSync(new URL("../guide-graphs/candidates/", import.meta.url)).filter((name) => name.endsWith(".graph.json"))
    .flatMap((name) => json(`../guide-graphs/candidates/${name}`).nodes);
  const bound = everyNode.filter((candidate) => (candidate.sourceRefs ?? []).includes(AMENDMENT)).map((candidate) => candidate.id);
  assert.deepEqual(bound, [NODE], "only the existing node carries the amendment");
  assert.deepEqual(everyNode.filter((candidate) => /INTENTION|EXPECTATION|RETROSPECT/u.test(candidate.id)).map((candidate) => candidate.id), [], "no duplicate node was added");
  assert.equal(new Set(everyNode.map((candidate) => candidate.id)).size, everyNode.length, "node ids are unique");
  // One recommendation, directly after the sequence recommendation and before the realistic-future-outcome one.
  const sequenceIndex = node.recommendations.findIndex((line) => /non-accusatory question/u.test(line));
  const reviewLines = node.recommendations.filter((line) => /review the completed encounter before choosing a next step/u.test(line));
  assert.equal(reviewLines.length, 1);
  const [review] = reviewLines;
  assert.equal(node.recommendations.indexOf(review), sequenceIndex + 1, "directly after the sequence recommendation");
  assert.match(node.recommendations[sequenceIndex + 2], /^Assess only demonstrated relational capacity/u);
  const futureIndex = node.recommendations.findIndex((line) => /^Define the realistic outcome before the interaction:/u.test(line));
  assert.ok(futureIndex > sequenceIndex + 1, "the future-outcome recommendation is separate and later");
  assert.match(review, /^Once that sequence is known well enough, review the completed encounter before choosing a next step: distinguish what the person was trying to achieve by communicating, the reaction they realistically anticipated at the time \(including surprise or a foreseeable tradeoff\), and how they now judge both their manner and what followed, then compare the three\./u);
  assert.match(review, /This is not the same as defining a realistic outcome for a future interaction \(below\)\./u);
  assert.match(review, /The next step may be communication repair, a boundary, a decision about relational fit or optional developmental work\./u);
  assert.match(review, /do not ask only that; the more useful questions are usually whether they expected the reaction and how they judge their choice now, and asking all three is not required every time\./u);
  assert.match(review, /Where threats or intimidation are actually supported, keep the existing safety and accountability distinctions and do not treat the threatening and the threatened party as equally responsible\./u);
  // One avoid line, last in the list.
  const avoid = node.avoid.filter((line) => /^Do not assume regret, fault, satisfaction, a wish to reconcile or a fixed character after a painful disagreement/u.test(line));
  assert.equal(avoid.length, 1);
  assert.equal(node.avoid.at(-1), avoid[0]);
  assert.match(avoid[0], /a person can stand by a position, regret the wording and grieve the loss at once/u);
  assert.match(avoid[0], /do not keep asking for incident detail unless the missing detail would change the next step or safety/u);
  // The safety gate, activation, question policy and the route's own question are unchanged.
  assert.ok(node.activation.none.some((condition) => condition.field === "present_safety" && condition.value === "unsafe"));
  assert.ok(node.activation.none.some((condition) => condition.field === "suicidal_state"));
  assert.ok(node.activation.none.some((condition) => condition.field === "relational_check_status"));
  assert.deepEqual(node.questionPolicy, { purpose: "discriminate", unresolvedFields: [] });
  assert.equal(node.defaultQuestion, QUESTION);

  const bundle = json("../guide-graphs/compiled/bundle.json");
  assert.equal(bundle.stats.ownerAmendmentCount, json("../guides/owner-amendments.json").items.length, "the compiled bundle counts every amendment");
  const compiled = bundle.graphs.flatMap((candidate) => candidate.nodes).find((candidate) => candidate.id === NODE);
  assert.deepEqual(compiled.recommendations, node.recommendations);
  assert.deepEqual(compiled.avoid, node.avoid);
  assert.deepEqual(compiled.sourceRefs, node.sourceRefs);
  const fresh = (await compileGuideGraphs({ write: false })).graphs.flatMap((candidate) => candidate.nodes).find((candidate) => candidate.id === NODE);
  assert.deepEqual(fresh, compiled, "the committed compiled node is what the source compiles to");
  assert.ok(read("../guide-graphs/source-maps/owner-amendments.json").includes(AMENDMENT));
  for (const note of [`governance/amendments/${AMENDMENT}.md`, `sources/owner-amendments/${AMENDMENT}.md`]) {
    assert.ok(fs.existsSync(new URL(`../authoring/obsidian/current/${note}`, import.meta.url)), `the Obsidian projection holds ${note}`);
  }
});

test("seven synthetic scenes cover the distinctions the lesson names, each with its own next step", () => {
  const corpus = json("../corpus/relational-intention-expectation-regression-cases.json");
  assert.equal(corpus.schema_version, 1);
  assert.match(corpus.privacy, /Entirely synthetic examples with invented people/u);
  // The scenes judge a reply's content; the corpus says plainly that the app's question contract is a separate matter.
  assert.match(corpus.limits, /a pending relational check still supplies the route's own sequence question as the final question/u);
  assert.match(corpus.limits, /replies written from the served protocol references/u);
  assert.equal(corpus.cases.length, 7);
  assert.equal(new Set(corpus.cases.map((fixture) => fixture.id)).size, corpus.cases.length, "ids are unique");
  assert.deepEqual(corpus.cases.map((fixture) => fixture.reading), [
    "unexpected-rejection-regret-about-tone", "knowingly-accepted-distance", "unexpected-rejection-regret-about-belief",
    "mixed-feelings", "foreseen-hostility", "threat-supported", "hope-known-expectation-and-judgment-open"
  ]);
  for (const fixture of corpus.cases) {
    assert.ok(fixture.input.length > 400 && fixture.pass_criterion.length > 800, fixture.id);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /https?:|@|\b\d{4,}\b/u, `${fixture.id} holds no link, address or number`);
    assert.match(fixture.pass_criterion, /\b(?:Do not|do not)\b/u, fixture.id);
    // Written about the person, never to them.
    assert.doesNotMatch(fixture.pass_criterion, /\b(?:you|your)\b/iu, `${fixture.id} is written about the person, not to them`);
    // Never forced childhood imagery: every scene says so, and no scene hands the model the guide's own terms or a childhood cause.
    assert.match(fixture.pass_criterion, /childhood/iu, `${fixture.id} rules out forced childhood imagery`);
    assert.doesNotMatch(fixture.input, /relational fit|communication repair|developmental|inner child|reparent|attachment|trauma|boundary|boundaries/iu, `${fixture.id} does not name the answer`);
    if (fixture.id !== "mixed-feelings-older-echo") assert.doesNotMatch(fixture.input, /childhood|growing up|school|as a child/iu, `${fixture.id} raises no childhood`);
    // No scene assumes regret, fault or a wish to reconcile on the person's behalf.
    assert.match(fixture.pass_criterion, /[Dd]o not (?:assume|pick|treat|look|search|run|make)/u, `${fixture.id} guards against an assumption`);
    // The next step is one of a closed set.
    assert.ok(NEXT_STEPS.includes(fixture.expected_next_step), `${fixture.id}: ${fixture.expected_next_step}`);
    // What the person has already said is not asked again.
    if (Object.values(fixture.known).every(Boolean)) assert.match(fixture.pass_criterion, /\b(?:do not ask|Do not ask)\b/u, `${fixture.id} does not re-ask what is known`);
  }
  const byId = new Map(corpus.cases.map((fixture) => [fixture.id, fixture]));
  // The four next steps the amendment names, plus safety first and one coherent inquiry, are each the answer to some scene.
  const steps = new Set(corpus.cases.map((fixture) => fixture.expected_next_step));
  for (const step of NEXT_STEPS) assert.ok(steps.has(step), `some scene calls for ${step}`);
  assert.ok(steps.size >= 6, "the next step is not the same in every scene");
  assert.equal(byId.get("foreseen-distance-accepted").expected_next_step, "a decision about relational fit");
  assert.equal(byId.get("foreseen-hostility-boundary").expected_next_step, "a boundary");
  assert.equal(byId.get("mixed-feelings-older-echo").expected_next_step, "optional developmental work");
  assert.equal(byId.get("supported-threat-asymmetry").expected_next_step, "safety and accountability handling");
  assert.equal(byId.get("hope-already-clear-one-inquiry").expected_next_step, "one coherent inquiry");
  // Regret about the wording and regret about the belief both call for repair, but of a different object, and each rules out the other's.
  const tone = byId.get("unexpected-silence-regret-wording");
  const belief = byId.get("unexpected-rejection-doubts-the-position");
  assert.equal(tone.expected_next_step, "communication repair");
  assert.equal(belief.expected_next_step, "communication repair");
  assert.notEqual(tone.repair_object, belief.repair_object);
  assert.match(tone.pass_criterion, /keeps her position/u);
  assert.match(tone.pass_criterion, /Do not ask her to retract the concern/u);
  assert.match(belief.pass_criterion, /about the belief and the accusation and not the wording/u);
  assert.match(belief.pass_criterion, /Do not offer polishing the wording as the repair/u);
  assert.match(belief.pass_criterion, /Do not assume she was wrong/u);
  // Unexpected rejection against knowingly accepted distance: the same kind of cost, a different next step, and the accepted cost is
  // neither searched for fault nor repaired by default.
  const accepted = byId.get("foreseen-distance-accepted");
  assert.match(accepted.pass_criterion, /Do not treat the distance as an unexpected rejection/u);
  assert.match(accepted.pass_criterion, /The comparison points away from repair/u);
  assert.match(accepted.pass_criterion, /Do not push a reconciliation message, an apology or a softer wording he has not said he regrets/u);
  assert.match(accepted.pass_criterion, /sadness is not evidence of a mistake/u);
  assert.match(tone.pass_criterion, /not a verdict on him/u);
  // Foreseen withdrawal against foreseen hostility: one decision about fit, one boundary.
  const hostility = byId.get("foreseen-hostility-boundary");
  assert.match(hostility.pass_criterion, /The comparison points to a boundary, not repair/u);
  assert.match(hostility.pass_criterion, /do not treat the insults as a sign that he should have softened it/u);
  assert.match(hostility.pass_criterion, /leaving whether to contact Elif privately to him/u);
  // Mixed feelings are not ranked, and developmental work is an invitation, not a condition.
  const mixed = byId.get("mixed-feelings-older-echo");
  assert.match(mixed.pass_criterion, /Do not pick one of the feelings as the real one and do not ask her to rank them/u);
  assert.match(mixed.pass_criterion, /can all be true together, and that none of them cancels another/u);
  assert.match(mixed.pass_criterion, /optional developmental work, as an invitation she can decline or postpone/u);
  assert.match(mixed.pass_criterion, /do not make that work a condition of deciding/u);
  assert.match(mixed.pass_criterion, /keep one primary next move/u);
  assert.match(mixed.input, /unprompted/u, "the older feeling is the person's own, not the scene's suggestion");
  // A supported threat keeps safety and the unequal responsibility, and the appraisal is not the lead.
  const threat = byId.get("supported-threat-asymmetry");
  assert.match(threat.pass_criterion, /Keep the existing safety and accountability handling and do not run the review of his manner and expectations as the lead/u);
  assert.match(threat.pass_criterion, /the two brothers are not equally responsible: a blunt sentence does not cause or excuse a threat/u);
  assert.match(threat.pass_criterion, /Put safety first/u);
  assert.match(threat.pass_criterion, /Do not make his regret or his expectations a condition for protective steps/u);
  assert.match(threat.pass_criterion, /do not treat wording repair or a reconciling message as the next step/u);
  // Hope already clear: do not ask it again; ask what is not known as one coherent inquiry, not three questions and not a list.
  const hope = byId.get("hope-already-clear-one-inquiry");
  assert.deepEqual(hope.known, { aim: true, expected_reaction: false, judgment_now: false });
  assert.match(hope.pass_criterion, /do not ask what she hoped for/u);
  assert.match(hope.pass_criterion, /Ask these together as one coherent inquiry serving the single decision of whether and how to reach out, in plain words and without a list, rather than in separate rounds or as three questions/u);
  assert.match(hope.pass_criterion, /Keep one primary next move and defer anything that would not change it/u);
  assert.match(hope.input, /She has not said whether Yuki's response was what she expected or how she feels about the way she raised it\./u, "the scene states what is still open");
  assert.doesNotMatch(hope.input, /regret/iu, "and never suggests that she regrets it");
  // Contrast pairs name each other, and no pair shares both a next step and a repair object.
  for (const fixture of corpus.cases) {
    for (const other of fixture.contrast_with) {
      const partner = byId.get(other);
      assert.ok(partner, `${fixture.id} names a scene that exists: ${other}`);
      assert.ok(partner.contrast_with.includes(fixture.id), `${other} names ${fixture.id} back`);
      assert.ok(fixture.expected_next_step !== partner.expected_next_step || fixture.repair_object !== partner.repair_object, `${fixture.id} and ${other} differ in what they call for`);
    }
  }
  // The scenes do not repeat the earlier lesson's job: each already gives its sequence, so none asks for it.
  for (const fixture of corpus.cases) assert.match(fixture.input, /\border\b.{0,20}\b(?:clearly|plainly)\b/u, `${fixture.id} already gives its sequence`);
});

test("the plan adapts to what remains to be done: outward action, nothing added, inward work as an option, or safety first", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const base = json("../corpus/graph-cases/G141.json").variables;
  const corpus = json("../corpus/relational-intention-expectation-regression-cases.json");
  const signatures = new Map();
  for (const fixture of corpus.cases) {
    const plan = planFromGraphs({ graphs: bundle.graphs, variables: { ...base, ...fixture.planner.variables } });
    const selected = plan.selectedNodes.map((item) => item.id);
    for (const id of fixture.planner.selected_includes ?? []) assert.ok(selected.includes(id), `${fixture.id} selects ${id}`);
    for (const id of fixture.planner.selected_excludes ?? []) assert.equal(selected.includes(id), false, `${fixture.id} does not select ${id}`);
    for (const id of fixture.planner.primary_excludes ?? []) assert.notEqual(plan.primaryJob.id, id, `${fixture.id} does not lead with ${id}`);
    if (plan.primaryJob.id === NODE) {
      // The reality check stays first and its recommendations carry the review of the completed encounter.
      const route = plan.selectedNodes.find((item) => item.id === NODE);
      assert.ok(route.recommendations.some((line) => /review the completed encounter before choosing a next step/u.test(line)), `${fixture.id} carries the review`);
      assert.ok(route.avoid.some((line) => /Do not assume regret, fault, satisfaction, a wish to reconcile or a fixed character/u.test(line)), `${fixture.id} carries the guard`);
      signatures.set(fixture.id, `${selected.includes("ROUTE.ACT_OUTWARD") ? "outward" : ""}|${selected.includes("ROUTE.GO_INWARD") ? "inward" : ""}`);
    } else {
      signatures.set(fixture.id, "safety first");
      assert.notEqual(plan.nextQuestion, QUESTION, `${fixture.id} does not put the sequence question ahead of safety`);
    }
  }
  // Four different plans across the scenes: outward action, nothing added, inward work as an option, and the reality check left for safety.
  assert.equal(signatures.get("unexpected-silence-regret-wording"), "outward|");
  assert.equal(signatures.get("unexpected-rejection-doubts-the-position"), "outward|");
  assert.equal(signatures.get("foreseen-hostility-boundary"), "outward|");
  assert.equal(signatures.get("hope-already-clear-one-inquiry"), "outward|");
  assert.equal(signatures.get("foreseen-distance-accepted"), "|");
  assert.equal(signatures.get("mixed-feelings-older-echo"), "|inward");
  assert.equal(signatures.get("supported-threat-asymmetry"), "safety first");
  assert.equal(new Set(signatures.values()).size, 4);
  // Inward work is added only where inward material is present, and does not displace the reality check.
  const inward = planFromGraphs({ graphs: bundle.graphs, variables: { ...base, ...corpus.cases.find((fixture) => fixture.id === "mixed-feelings-older-echo").planner.variables } });
  assert.equal(inward.primaryJob.id, NODE);
});

test("the review is not asked ahead of safety, and a completed or unneeded check leaves the route", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const base = json("../corpus/graph-cases/G141.json").variables;
  for (const override of [{ present_safety: "unsafe" }, { suicidal_state: "ideation" }]) {
    const plan = planFromGraphs({ graphs: bundle.graphs, variables: { ...base, ...override } });
    assert.notEqual(plan.primaryJob.id, NODE, JSON.stringify(override));
  }
  const unsafe = planFromGraphs({ graphs: bundle.graphs, variables: { ...base, present_safety: "unsafe" } });
  assert.equal(unsafe.nextQuestion, "");
  assert.equal(unsafe.questionContract.mode, "none");
  for (const relational_check_status of ["completed", "not_needed"]) {
    const plan = planFromGraphs({ graphs: bundle.graphs, variables: { ...base, relational_check_status } });
    assert.notEqual(plan.primaryJob.id, NODE, relational_check_status);
    assert.notEqual(plan.nextQuestion, QUESTION, relational_check_status);
  }
  // The route's recommendations about the future outcome and the completed encounter are different things and both stay.
  const graph = json("../guide-graphs/candidates/cross-guide.graph.json");
  const node = graph.nodes.find((candidate) => candidate.id === NODE);
  assert.ok(node.recommendations.some((line) => /^Define the realistic outcome before the interaction:/u.test(line)));
  assert.ok(node.recommendations.some((line) => /review the completed encounter before choosing a next step/u.test(line)));
});

test("graph cases G142 to G144 cover a step left to take, an accepted cost and an older feeling, and the whole suite passes", async () => {
  const cases = ["G142", "G143", "G144"].map((id) => json(`../corpus/graph-cases/${id}.json`));
  const base = json("../corpus/graph-cases/G141.json").variables;
  for (const fixture of cases) {
    assert.equal(fixture.expected.primary, NODE, fixture.id);
    assert.deepEqual(fixture.expected.requiredNuancePatterns, ["Relational capacity is not motive or diagnosis"], fixture.id);
    assert.deepEqual(fixture.expected.forbiddenOverclaimPatterns, ["hidden motives or fixed character"], fixture.id);
    // Same invented account as G141, changed only in what is left to do.
    for (const [field, value] of Object.entries(fixture.variables)) {
      if (!["relational_capacity_evidence", "actionable_problem", "unresolved_inner_material"].includes(field)) assert.equal(value, base[field], `${fixture.id} ${field}`);
    }
  }
  assert.deepEqual(cases[0].expected.selectedIncludes, [NODE, "ROUTE.ACT_OUTWARD"]);
  assert.deepEqual(cases[0].expected.selectedExcludes, ["ROUTE.GO_INWARD", "ROUTE.LEAVE_ALONE"]);
  assert.deepEqual(cases[1].expected.selectedExcludes, ["ROUTE.ACT_OUTWARD", "ROUTE.GO_INWARD", "ROUTE.LEAVE_ALONE"]);
  assert.deepEqual(cases[2].expected.selectedIncludes, [NODE, "ROUTE.GO_INWARD"]);
  assert.deepEqual(cases[2].expected.selectedExcludes, ["ROUTE.ACT_OUTWARD", "ROUTE.LEAVE_ALONE"]);
  const result = await runGraphRegressionSuite();
  for (const id of ["G013", "G141", "G142", "G143", "G144"]) assert.equal(result.results.find((item) => item.id === id)?.ok, true, id);
  assert.equal(result.ok, true);
  assert.equal(result.count, 119);
});

test("AI guide r9 is r8 plus the owner's two sentences directly after the going-back sentence, and r8 stays immutable", () => {
  const manifest = json("../guides/manifest.json");
  const active = manifest.sources.find((source) => source.id === "inner-child-guide");
  assert.equal(active.file, "inner-child-guide-2026-10-31-r9.txt");
  assert.equal(active.version, "owner-approved-conflict-appraisal-addition-2026-10-31-r9");
  // Later the same day the owner approved three Inner Child refinements (issue 215), made inside r9 itself. They are tested in the
  // guide source-sync test; taking them out here leaves the question 51 form this test is about, byte for byte.
  const r9Now = read("../guides/inner-child-guide-2026-10-31-r9.txt");
  const r9 = withoutIssue215(r9Now);
  const r8 = read("../guides/inner-child-guide-2026-10-30-r8.txt");
  assert.equal(sha256(r9Now), active.sha256);
  assert.equal(sha256(r9), QUESTION_51_R9_SHA256);
  assert.equal(count(r9, `${ANCHOR} ${ADDITION}`), 1, "the two sentences follow the anchor sentence, once");
  assert.equal(count(r9, ADDITION), 1);
  assert.equal(count(r8, "After a painful disagreement, ask what you were trying to achieve"), 0, "r8 does not carry them");
  assert.equal(r9.replace(` ${ADDITION}`, ""), r8, "r9 is r8 plus exactly the two sentences, with nothing else changed");
  assert.match(r9.slice(r9.indexOf(ADDITION) + ADDITION.length), /^ Someone disagreeing with you, needing time, or setting their own boundary does not make them emotionally immature\./u);
  assert.equal(ADDITION.length, 318);
  const earlier = manifest.sourceHistory.find((entry) => entry.version === "owner-approved-disclosure-additions-2026-10-30-r8");
  assert.equal(earlier?.file, "inner-child-guide-2026-10-30-r8.txt");
  assert.equal(sha256(r8), earlier.sha256, "r8 is byte for byte what the manifest recorded");
  assert.match(manifest.notes, /question 51, option A, answered 31 October 2026 at 12:43 UTC/u);
});

test("the humanized-guide queue carries the same teaching point as PGQ-051, and nothing else about it is published", () => {
  const queue = read("../authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /^### PGQ-051 — After a painful disagreement, ask what you aimed for, what you expected and how you judge it now$/mu);
  const start = queue.indexOf("### PGQ-051 — ");
  const ends = ["\n### ", "\n## "].map((marker) => queue.indexOf(marker, start + 5)).filter((index) => index !== -1);
  const entry = queue.slice(start, ends.length ? Math.min(...ends) : undefined);
  const lines = entry.split("\n");
  for (const field of ["Caused by", "Teaching point", "Reader need", "Already covered", "Where"]) assert.equal(lines.filter((line) => line.startsWith(`${field}: `)).length, 1, field);
  assert.equal(lines.find((line) => line.startsWith("Teaching point: ")), `Teaching point: ${ADDITION}`);
  assert.match(entry, /Owner answer of 31 Oct 2026, 12:43 UTC/u);
  assert.match(entry, /question 51, option A/u);
  assert.ok(entry.includes(AMENDMENT));
  assert.ok(entry.includes("inner-child-guide-2026-10-31-r9.txt"));
  assert.ok(entry.includes(ANCHOR));
  // "Already covered" points at the guide's own lines: the owner's two sentences are in the paragraph at r9 line 153, and the paragraph
  // after it, at line 155, is the one that says feeling guilty proves neither fault nor manipulation.
  const r9Lines = read("../guides/inner-child-guide-2026-10-31-r9.txt").split("\n");
  assert.ok(r9Lines[152].includes(ADDITION), "line 153 carries the owner's two sentences");
  assert.match(r9Lines[154], /^Notice your side too\. Feeling guilty does not prove that you did something wrong; it also does not prove that somebody manipulated you\./u);
  assert.ok(entry.includes("does not make someone emotionally immature, and the paragraph after it (r9 line 155) says that feeling guilty proves neither fault nor manipulation."));
  assert.match(entry, /not publication authority/u);
  assert.match(queue, /^Queue version: 2026-10-31-r19$/mu);
  // The earlier entries on the same passage and on the schema comparison are still there, once.
  for (const id of ["PGQ-049", "PGQ-050"]) assert.equal(count(queue, `\n### ${id} — `), 1, id);
});

test("the lesson, the state section, the ledger and the intake receipt carry the change", () => {
  const lessons = read("../THERAPY-LESSONS");
  assert.match(lessons, /\n## 2026-10-31 — After a painful disagreement, compare what was intended, what was expected and how it is judged now\n/u);
  const start = lessons.indexOf("## 2026-10-31 — After a painful disagreement");
  const lesson = lessons.slice(start, lessons.indexOf("\nThis root log records", start));
  for (const part of [AMENDMENT, NODE, "question 51, option A", "focus-discipline-v1", "response-fidelity", "PGQ-051", "AI guide r9", "no new evaluator", "do not show that any model follows the rules", "the planner still gives the route's own sequence question"]) {
    assert.ok(lesson.includes(part), part);
  }
  assert.doesNotMatch(lesson, /https?:|@/u);
  const state = read("../state/CODEX-CURRENT-STATE.md");
  assert.equal((state.match(/^Updated: /gmu) ?? []).length, 1, "exactly one Updated line");
  assert.match(state, /^Updated: 2026-10-31$/mu);
  const heading = state.indexOf("## Intention, expected reaction and later judgment after a conflict");
  assert.ok(heading > 0, "the state section exists");
  const section = state.slice(heading, state.indexOf("\n## ", heading + 5));
  for (const part of [AMENDMENT, NODE, "focus-discipline-v1", "RESPONSE-FIDELITY.md", "FOCUS-DISCIPLINE.md", "inner-child-guide-2026-10-31-r9.txt", "PGQ-051", "51a", "No new evaluator", "G142", "Known limit", "DEFERRED to ADOPTED", "PROPOSED_ON_TASK_BRANCH", "owner-amendments-2026-10-31-r21"]) {
    assert.ok(section.includes(part), part);
  }
  // The earlier performed-self section no longer says this item is untouched.
  const earlier = state.slice(state.indexOf("## Performed self and permissive reparenting"), heading);
  assert.doesNotMatch(earlier, /is untouched\./u);
  assert.match(earlier, /was added after the owner's answer 51a/u);
  const ledger = read("../docs/suggested-fixes-ledger.md");
  const entry = ledger.slice(ledger.indexOf("## 2026-10-31 — Intention, expected reaction and later judgment after a conflict"));
  const ledgerEntry = entry.slice(0, entry.indexOf("\n## ", 5) === -1 ? undefined : entry.indexOf("\n## ", 5));
  for (const part of ["universal-dev-architecture", "#452", "superseded", "2026-10-31, 12:43 UTC", "question 51 with A", "ADOPT, adapted", AMENDMENT, "no new evaluator", "PGQ-051", "ADOPTED", "PROPOSED_ON_TASK_BRANCH", "deployment stays separately gated"]) {
    assert.ok(ledgerEntry.includes(part), part);
  }
  const receipts = json("../docs/suggested-fixes-inbox-receipts.json");
  const matching = receipts.receipts.filter((candidate) => candidate.path === "suggested-fixes/innerSignalGraph/2026-10-30-interpersonal-intention-expectation-retrospective-review.md");
  assert.equal(matching.length, 1, "one receipt");
  const [receipt] = matching;
  assert.equal(receipt.disposition, "ADOPTED");
  assert.equal(receipt.implementation, "PROPOSED_ON_TASK_BRANCH");
  for (const part of [AMENDMENT, NODE, "focus-discipline-v1", "response-fidelity", "AI guide r9", "PGQ-051", "PR #213", "51a"]) assert.ok(receipt.destination.includes(part), part);
  assert.match(receipt.nextCondition, /Review and merge the candidate PR to main/u);
  assert.match(receipt.nextCondition, /deployment is a separate owner-gated step/u);
  // The earlier missing-middle receipt is unchanged.
  const sequenceReceipt = receipts.receipts.find((candidate) => candidate.path === "suggested-fixes/innerSignalGraph/2026-10-28-reconstruct-reciprocal-conflict-sequence.md");
  assert.equal(sequenceReceipt.disposition, "ADOPTED");
  assert.ok(sequenceReceipt.destination.includes(SEQUENCE_AMENDMENT));
});
