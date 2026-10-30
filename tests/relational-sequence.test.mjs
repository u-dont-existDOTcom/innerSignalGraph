import test from "node:test";
import assert from "node:assert/strict";
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
import { canonicalQuestion, enforceResponseContract } from "../src/orchestrator/response-contract.mjs";

// Owner request of 28 October 2026 (a de-identified lesson from the architecture repository's suggested-fix lane): before
// interpreting a reported conflict, recover what each person said and did. Every example is synthetic. These static tests show
// where the rule is written, served, wired and bound; they do not show that a model follows it.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const count = (text, part) => text.split(part).length - 1;
const AMENDMENT = "AMEND.CROSS.RELATIONAL_SEQUENCE_BOTH_SIDES_20261028";
const NODE = "ROUTE.RELATIONAL_REALITY_CHECK";
const CODE = "MISSING_MIDDLE_INTERPRETATION";
// The route's own question: the planner copies it, the realization step must copy it exactly, and the response contract appends it.
const QUESTION = "What did each of you actually say and do, in order, and what has this person shown they can do when you disagree, say no, or ask for repair?";
// An account of wanting acceptance, a confrontation and rejection whose sequence has not been given (invented, no person).
const MISSING_SEQUENCE = {
  present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent",
  activation: "moderate", dissociation: "none", altered_state: "sober", other_person_central: "yes", belonging_pressure: "present",
  influence_domain: "ordinary_social", relational_capacity_evidence: "insufficient", relational_check_status: "pending",
  actionable_problem: "present", unresolved_inner_material: "present", inward_attention_effect: "neutral"
};
const FOCUS = "references/FOCUS-DISCIPLINE.md";
const FIDELITY = "references/RESPONSE-FIDELITY.md";
const BULLET_START = "- When a client describes wanting acceptance, then a disagreement or confrontation, then rejection, recover the missing middle before interpreting it:";
// Clauses the rule and the amendment share word for word, apart from "client" and "person".
const SHARED_CLAUSES = [
  "recover the missing middle before interpreting it: what was first said and done, what the",
  "said and did, what the other person said and did, the timing and any boundaries stated, and how the",
  "read the result.",
  "When that sequence is missing, ask one specific, non-accusatory question about it, one whose plausible answers would change the next step (protective action, accountability or communication work, or developmental integration), before deciding who caused the rupture or whether an old developmental pattern explains it.",
  "Do not repeat a question the",
  "has already answered.",
  "Keep observations, emotions, beliefs about motives and justifications apart: wanting love does not show that a confrontation was loving, and another person's discomfort does not show that they were coercive or were rejecting the",
  "Genuine exclusion, a legitimate boundary in response to confrontational behavior, mixed escalation and an unknown chronology are all possible until the sequence says which fits.",
  "Anger is not hatred or current harmful intent.",
  "Where threats or intimidation are actually supported, keep the existing safety and accountability distinctions, and do not treat the more powerful or threatening party and the threatened party as equally responsible.",
  "Never force childhood imagery onto the account."
];

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

test("the rule is one bullet in the focus rules, written to InnerSignal, and carries every clause of the amendment", () => {
  const bullets = focusDisciplineRules.split("\n").filter((line) => line.startsWith(BULLET_START));
  assert.equal(bullets.length, 1, "one bullet");
  const [bullet] = bullets;
  for (const clause of SHARED_CLAUSES) assert.ok(bullet.includes(clause), clause);
  assert.ok(bullet.includes("what the client said and did"));
  assert.ok(bullet.includes("how the client read the result"));
  // It addresses InnerSignal about "the client"; it never speaks to the client as "you".
  assert.doesNotMatch(bullet, /\byou(?:r|rs|rself)?\b/iu);
  assert.deepEqual(unservedReferenceMentions(bullet), []);
  // It sits inside the focus block, whose version label and opening rule are unchanged.
  assert.match(focusDisciplineRules, /^\nFOCUS DISCIPLINE \(focus-discipline-v1\)\n- The therapist keeps the session on point\./u);
});

test("the served focus reference ends with the module text byte for byte, and only the focus reference carries the bullet", () => {
  const reference = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/FOCUS-DISCIPLINE.md");
  assert.ok(reference.endsWith(focusDisciplineRules), "byte for byte");
  const protocol = loadTherapyProtocol();
  const served = protocol.files.find((file) => file.path === FOCUS);
  assert.equal(served.content, reference);
  assert.equal(count(served.content, BULLET_START), 1);
  for (const file of protocol.files) {
    if (file.path !== FOCUS) assert.equal(file.content.includes(BULLET_START), false, `${file.path} does not carry the bullet`);
  }
});

test("the audit failure is wired once among the response-fidelity checks, in the module and its served mirror", () => {
  const line = responseFidelityRules.split("\n").find((entry) => entry.startsWith(`- ${CODE}: `));
  assert.ok(line, "the code has a definition line");
  assert.equal(count(responseFidelityRules, `\n- ${CODE}: `), 1);
  assert.ok(responseFidelityRules.indexOf(`\n- ${CODE}: `) > responseFidelityRules.indexOf("RESPONSE FIDELITY AUDIT FAILURES"), "in the audit-failure list");
  // The three ways to fail, and the exemption for supported threats.
  assert.match(line, /interprets a reported rupture \(who caused it, an old developmental pattern, the other person's motives\) while the sequence of what each person said and did is missing and has not been asked for/u);
  assert.match(line, /treats wanting love as proof that a confrontation was loving/u);
  assert.match(line, /another person's discomfort as proof of coercion or of rejecting the person's beliefs/u);
  assert.match(line, /supported threats or intimidation keep their separate safety and accountability handling and are not this failure/u);
  // The neighbouring codes are untouched.
  for (const code of ["SPLIT_FOCUS_RETURN", "RESPONSE_DUPLICATION", "REFRACTORY_PEAK_REASK", "LEGAL_CLINICAL_CONSENT_COLLAPSE"]) assert.equal(count(responseFidelityRules, `\n- ${code}: `), 1, code);
  const reference = read("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/RESPONSE-FIDELITY.md");
  assert.equal(reference.slice(reference.indexOf("RESPONSE FIDELITY AND PRACTICAL CARE VALUE")).trim(), responseFidelityRules.trim());
  assert.equal(count(reference, `\n- ${CODE}: `), 1);
  assert.equal(loadTherapyProtocol().files.find((file) => file.path === FIDELITY).content, reference);
});

test("no new evaluator: the code lives only in the response-fidelity module and reaches the existing review roles", () => {
  assert.deepEqual(sourceFilesMentioning(CODE), ["../src/prompts/response-fidelity.mjs"]);
  assert.equal(count(longitudinalClinicalRules, `\n- ${CODE}: `), 1);
  assert.ok(sharedClinicalRules.includes(longitudinalClinicalRules));
  for (const [role, prompt, carriesFidelity] of rolePrompts()) {
    assert.equal(count(prompt.system, BULLET_START), 1, `${role} carries the focus bullet once`);
    assert.equal(count(prompt.system, `- ${CODE}: `), carriesFidelity ? 1 : 0, `${role} names the audit failure ${carriesFidelity ? "once" : "not at all (it does not carry the fidelity rules)"}`);
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
  assert.equal(item.approvedAt, "2026-10-28");
  assert.equal(amendments.items.filter((entry) => entry.id === AMENDMENT).length, 1, "recorded once");
  assert.match(item.text, /^When a person describes wanting acceptance, then a disagreement or confrontation, then rejection, recover the missing middle before interpreting it:/u);
  for (const clause of SHARED_CLAUSES) assert.ok(item.text.includes(clause), clause);
  assert.ok(item.text.includes("what the person said and did"));
  assert.ok(item.text.includes("how the person read the result"));
  // Written to InnerSignal about "the person", never to the client as "you".
  assert.doesNotMatch(item.text, /\byou(?:r|rs|rself)?\b/iu);
});

test("the amendment is bound to the relational reality check, the first recommendation covers both sides, and the compiled graph agrees", async () => {
  const graph = json("../guide-graphs/candidates/cross-guide.graph.json");
  const node = graph.nodes.find((candidate) => candidate.id === NODE);
  assert.ok(node.sourceRefs.includes(AMENDMENT));
  assert.equal(node.sourceRefs.filter((ref) => ref === AMENDMENT).length, 1, "bound once");
  // Both sides, in order, including the user's own words and actions; no longer the other person's behavior alone.
  assert.match(node.recommendations[0], /^Before analyzing the user's trigger, use detached observation: state what each person actually said and did, in order, including the user's own words and actions as well as the other person's, without filling in motive or diagnosis\.$/u);
  assert.doesNotMatch(node.recommendations[0], /what the other person actually did, in sequence/u);
  // One recommendation for the question and for holding back cause and pattern until the sequence is known.
  const lines = node.recommendations.filter((line) => /non-accusatory question/u.test(line));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /ask for it before interpreting, with one specific, non-accusatory question about what each person said and did, in order/u);
  assert.match(lines[0], /\(this route's next question does this\)/u);
  assert.match(lines[0], /whose plausible answers would change the next step among protective action, accountability or communication work, and developmental integration/u);
  assert.match(lines[0], /Do not decide who caused the rupture, or apply an old developmental pattern, before the sequence is known/u);
  assert.match(lines[0], /do not repeat a question the person has already answered/u);
  // The safety gate, activation and question policy are unchanged.
  assert.ok(node.activation.none.some((condition) => condition.field === "present_safety" && condition.value === "unsafe"));
  assert.ok(node.activation.none.some((condition) => condition.field === "suicidal_state"));
  assert.deepEqual(node.questionPolicy, { purpose: "discriminate", unresolvedFields: [] });
  // The route's own question asks for both sides in order and keeps the demonstrated-capacity half it always had.
  assert.equal(node.defaultQuestion, QUESTION);
  assert.match(node.defaultQuestion, /^What did each of you actually say and do, in order, and what has this person shown they can do when you disagree, say no, or ask for repair\?$/u);
  assert.doesNotMatch(node.defaultQuestion, /\b(?:why did you|whose fault|who started|who is to blame)\b/iu, "the question accuses no one");

  const bundle = json("../guide-graphs/compiled/bundle.json");
  assert.equal(bundle.stats.ownerAmendmentCount, json("../guides/owner-amendments.json").items.length, "the compiled bundle counts every amendment");
  const compiled = bundle.graphs.flatMap((candidate) => candidate.nodes).find((candidate) => candidate.id === NODE);
  assert.deepEqual(compiled.recommendations, node.recommendations);
  assert.deepEqual(compiled.sourceRefs, node.sourceRefs);
  const fresh = (await compileGuideGraphs({ write: false })).graphs.flatMap((candidate) => candidate.nodes).find((candidate) => candidate.id === NODE);
  assert.deepEqual(fresh, compiled, "the committed compiled node is what the source compiles to");
  assert.ok(read("../guide-graphs/source-maps/owner-amendments.json").includes(AMENDMENT));
  assert.ok(fs.existsSync(new URL(`../authoring/obsidian/current/governance/amendments/${AMENDMENT}.md`, import.meta.url)), "the Obsidian projection holds the amendment");
});

test("synthetic scenes cover exclusion first, a boundary after hostility, mutual escalation, an unknown sequence and a supported threat", () => {
  const cases = json("../corpus/relational-sequence-regression-cases.json");
  assert.equal(cases.schema_version, 1);
  assert.match(cases.privacy, /Entirely synthetic examples with invented people/u);
  assert.equal(cases.cases.length, 5);
  assert.equal(new Set(cases.cases.map((fixture) => fixture.id)).size, cases.cases.length, "ids are unique");
  const readings = ["genuine-exclusion", "legitimate-boundary", "mixed-escalation", "unknown-chronology", "threat-supported"];
  assert.deepEqual(cases.cases.map((fixture) => fixture.reading), readings, "each pattern the rule names has its own scene");
  for (const fixture of cases.cases) {
    assert.equal(fixture.expected_failure_code, CODE, fixture.id);
    assert.ok(responseFidelityRules.includes(`- ${fixture.expected_failure_code}: `), `${fixture.id} names a wired audit failure`);
    assert.ok(fixture.input.length > 200 && fixture.pass_criterion.length > 400, fixture.id);
    assert.doesNotMatch(`${fixture.input} ${fixture.pass_criterion}`, /https?:|@|\b\d{4,}\b/u, `${fixture.id} holds no link, address or number`);
    // Never forced childhood imagery: every scene says so.
    assert.match(fixture.pass_criterion, /childhood/iu, `${fixture.id} rules out forced childhood imagery`);
    assert.match(fixture.pass_criterion, /\b(?:Do not|do not|Don't|don't)\b/u, fixture.id);
    // The scenes do not feed the model the answer: nothing in an input names a childhood cause or a developmental pattern, except
    // where the invented person raises it and the criterion says not to accept it.
    if (fixture.id !== "sequence-unknown") assert.doesNotMatch(fixture.input, /childhood|inner child|growing up/iu, fixture.id);
  }
  const byReading = new Map(cases.cases.map((fixture) => [fixture.reading, fixture]));
  // (a) rejection came before any confrontation: exclusion is supported, and the late message is not the cause.
  assert.match(byReading.get("genuine-exclusion").pass_criterion, /came first and her angry message came after, so her confrontation did not cause the rupture and a reading of real exclusion is supported/u);
  assert.match(byReading.get("genuine-exclusion").pass_criterion, /do not ask again for a sequence she has already given/u);
  // (b) hostile approach, then a stated boundary: wanting love does not make the messages loving; no coercion is read into it.
  assert.match(byReading.get("legitimate-boundary").pass_criterion, /fits a legitimate boundary in response to confrontational behavior at least as well as exclusion/u);
  assert.match(byReading.get("legitimate-boundary").pass_criterion, /wanting love does not show the messages were loving/u);
  assert.match(byReading.get("legitimate-boundary").pass_criterion, /not proof of coercion, hatred or rejection of his views/u);
  // (c) both escalated: neither side is made the cause.
  assert.match(byReading.get("mixed-escalation").pass_criterion, /both of them escalated, in the order Imani gives, without assigning the rupture to one side/u);
  // (d) the sequence is unknown: no cause and no old-pattern reading, and one question whose answers lead to different next steps.
  const unknown = byReading.get("unknown-chronology");
  assert.match(unknown.pass_criterion, /Do not decide who caused the rupture/u);
  assert.match(unknown.pass_criterion, /Ask one specific, non-accusatory question about the sequence/u);
  assert.match(unknown.pass_criterion, /whose plausible answers would change the next step/u);
  assert.match(unknown.input, /does not say what either of them said or did, or in what order/u);
  const steps = new Set(unknown.next_step_by_answer.map((entry) => entry.next_step));
  assert.deepEqual([...steps].sort(), ["accountability or communication work", "developmental integration", "protective action"]);
  for (const entry of unknown.next_step_by_answer) assert.ok(entry.answer.length > 40, entry.answer);
  for (const fixture of cases.cases) if (fixture !== unknown) assert.equal(Object.hasOwn(fixture, "next_step_by_answer"), false, `${fixture.id} already gives its sequence`);
  // (e) a threat that is actually supported keeps protection first and the two parties unequal.
  const threat = byReading.get("threat-supported");
  assert.match(threat.pass_criterion, /keep the separate safety and accountability handling/u);
  assert.match(threat.pass_criterion, /[Dd]o not treat her shouting once and his threat as equal responsibility/u);
  assert.match(threat.pass_criterion, /do not make recovering the full sequence a condition for protective steps/u);
});

test("the planner's contract question for an incomplete conflict account asks for both sides in order, and the response contract delivers it", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const plan = planFromGraphs({ graphs: bundle.graphs, variables: MISSING_SEQUENCE });
  assert.equal(plan.primaryJob.id, NODE);
  assert.equal(plan.nextQuestion, QUESTION);
  assert.deepEqual(plan.questionContract, { mode: "canonical", question: QUESTION, source: { type: "graph-node", id: NODE } });
  const route = plan.selectedNodes.find((item) => item.id === NODE);
  assert.ok(route.recommendations.some((line) => /state what each person actually said and did, in order, including the user's own words and actions/u.test(line)));
  assert.ok(route.recommendations.some((line) => /\(this route's next question does this\)/u.test(line)));
  // A reply cannot swap in a question of its own: the response contract strips a final question the plan did not authorize and
  // appends the plan's, and a replacement offered by the adjudicator does not displace it.
  const adjudication = { next_question: "Why did you start the fight?" };
  assert.equal(canonicalQuestion({ plan, adjudication }), QUESTION);
  const delivered = enforceResponseContract({
    answer: "That sounds painful, and I do not want to guess who did what yet.\n\nWhy did you start the fight?",
    next_question: "Why did you start the fight?"
  }, { plan, adjudication });
  assert.equal(delivered.next_question, QUESTION);
  assert.ok(delivered.answer.endsWith(QUESTION));
  assert.doesNotMatch(delivered.answer_body, /start the fight/u);
  assert.match(delivered.responseContract.strippedUnauthorizedFinalQuestion, /start the fight/u);
  assert.equal(delivered.responseContract.canonicalQuestion, QUESTION);
});

test("the sequence question is not asked ahead of safety, and not asked again once the reality check is done", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  // Present danger or suicidal ideation sends the plan to the protective routes; the sequence question is never the contract question.
  for (const override of [{ present_safety: "unsafe" }, { suicidal_state: "ideation" }]) {
    const plan = planFromGraphs({ graphs: bundle.graphs, variables: { ...MISSING_SEQUENCE, ...override } });
    assert.notEqual(plan.primaryJob.id, NODE, JSON.stringify(override));
    assert.notEqual(plan.nextQuestion, QUESTION, JSON.stringify(override));
  }
  const unsafe = planFromGraphs({ graphs: bundle.graphs, variables: { ...MISSING_SEQUENCE, present_safety: "unsafe" } });
  assert.equal(unsafe.nextQuestion, "");
  assert.equal(unsafe.questionContract.mode, "none");
  // Once the relational check is completed or not needed, the route leaves the plan, so the same question is not put again.
  for (const relational_check_status of ["completed", "not_needed"]) {
    const plan = planFromGraphs({ graphs: bundle.graphs, variables: { ...MISSING_SEQUENCE, relational_check_status } });
    assert.notEqual(plan.primaryJob.id, NODE, relational_check_status);
    assert.notEqual(plan.nextQuestion, QUESTION, relational_check_status);
  }
});

test("the graph regression cases cover the incomplete account and the route's changed question", async () => {
  const missing = json("../corpus/graph-cases/G141.json");
  assert.equal(missing.id, "G141");
  assert.deepEqual(missing.variables, MISSING_SEQUENCE, "the case holds the same invented account the planner tests use");
  assert.equal(missing.expected.primary, NODE);
  assert.equal(missing.expected.nextQuestion, QUESTION);
  assert.equal(json("../corpus/graph-cases/G013.json").expected.nextQuestion, QUESTION, "the older relational case follows the route's question");
  const result = await runGraphRegressionSuite();
  for (const id of ["G013", "G141"]) assert.equal(result.results.find((item) => item.id === id)?.ok, true, id);
  assert.equal(result.ok, true);
});

test("the rule does not displace safety: the protective rules it must agree with are still in force", () => {
  // The new bullet asks for a sequence, never ahead of safety; the focus block still puts safety and urgent red flags first.
  assert.match(focusDisciplineRules, /Every rule here has exceptions\. Safety, consent, a client's deliberate and reasoned change of agenda/u);
  assert.match(focusDisciplineRules, /Hard safety gates and clearly urgent medical red flags are exempt from ordinary parking/u);
  // Related rules: a question earns its place by what it changes; known answers are not asked again; the relational capacity
  // evidence the reality check uses stays separate from motive.
  assert.match(focusDisciplineRules, /A question earns its place when its plausible answers would change what is done next/u);
  assert.match(longitudinalClinicalRules, /Treat statements such as 'I knew this person was evil' or other conclusions about an external person or event as appraisals\/claims rather than proof/u);
  const graph = json("../guide-graphs/candidates/cross-guide.graph.json");
  const node = graph.nodes.find((candidate) => candidate.id === NODE);
  assert.ok(node.avoid.some((line) => /Do not diagnose or automatically label another person emotionally immature, manipulative, narcissistic, or unsafe from a disagreement/u.test(line)));
  assert.ok(node.effects.requiredNuance.some((line) => /Relational capacity is not motive or diagnosis/u.test(line)));
});

test("the lesson, the state section, the ledger and the intake receipt carry the change", () => {
  const lessons = read("../THERAPY-LESSONS");
  assert.match(lessons, /\n## 2026-10-28 — Recover what each person said and did before interpreting a reported rupture\n/u);
  assert.ok(lessons.includes(AMENDMENT));
  assert.ok(lessons.includes(CODE));
  const state = read("../state/CODEX-CURRENT-STATE.md");
  const section = state.slice(state.indexOf("## Reconstructing the missing middle of a conflict"));
  assert.ok(section.length > 100, "the state section exists");
  for (const part of [AMENDMENT, CODE, "ROUTE.RELATIONAL_REALITY_CHECK", "focus-discipline-v1", "app-only", "question 46", "IC.DIFFERENTIATION"]) {
    assert.ok(section.slice(0, section.indexOf("\n## ", 5)).includes(part), part);
  }
  const ledger = read("../docs/suggested-fixes-ledger.md");
  const entry = ledger.slice(ledger.indexOf("2026-10-28-reconstruct-reciprocal-conflict-sequence.md"));
  assert.ok(entry.length > 100, "the ledger names the item");
  for (const part of ["universal-dev-architecture", "#442", "ADOPT", "no new evaluator", "question 46", "delivery"]) assert.ok(entry.includes(part), part);
  const receipts = json("../docs/suggested-fixes-inbox-receipts.json");
  const receipt = receipts.receipts.find((candidate) => candidate.path === "suggested-fixes/innerSignalGraph/2026-10-28-reconstruct-reciprocal-conflict-sequence.md");
  assert.equal(receipt?.disposition, "ADOPTED");
  assert.ok(receipt.destination.includes(AMENDMENT));
  assert.ok(receipt.nextCondition.length > 20);
});
