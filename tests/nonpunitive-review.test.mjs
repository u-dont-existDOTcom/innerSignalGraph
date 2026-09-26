import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

// Owner decision D09 (2026-08-29), reaffirmed 2026-09-26: review self-care
// attempts without self-judgment, grading, or a trial. These tests pin the
// reconciled map content and its reach into planning and realization; they do
// not establish clinical usefulness.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const amendmentId = "AMEND.IC.NONPUNITIVE_REVIEW";
const d09Statement = "Review is critical. Notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial. No mandatory morning/evening cadence is established.";
const reviewLine = "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time.";
const repairLine = "When an effort at improvement doesn’t go as hoped, name what happened, repair what can be repaired, and make the next promise more credible.";
const avoidPunitive = "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance.";
const avoidWorthVerdict = "Do not turn a lapse or repeated pattern into a verdict about intrinsic worth. Review may still conclude that a particular commitment currently exceeds capacity or requires stronger limits, support, or a different plan.";
const successSignal = "The review yields clearer understanding and either one bounded repair or adjustment, or a clear conclusion that no change is needed, without materially escalating self-attack.";
const accountabilityNuance = "Review distinguishes accountability and learning from punishment or judgments about worth. Accountability may still include consequences, firmer boundaries, and an honest assessment of present capacity.";
const credibilityNuance = "A missed commitment matters, but it is not the whole credibility picture. Consider what was actually agreed, present capacity and circumstances, acknowledgement and repair, and kept commitments—without using positive evidence to cancel or minimize a serious lapse.";
const reviewNodes = ["IC.ADULT_APPRENTICE", "IC.CREDIBILITY_REPAIR", "IC.PROTECTOR_ACTION"];

let bundle;
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const node = (id) => bundle.graphs.flatMap((graph) => graph.nodes).find((item) => item.id === id);
const proposalCase = (id) => readJson(`authoring/obsidian/proposals/nonpunitive-review-20260926/tests/${id}.json`);
const plan = (definition) => planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: bundle.graphs });

test.before(async () => {
  bundle = await compileGuideGraphs({ root, write: false });
});

test("D09 is one exact owner amendment and its overlay is reconciled into the three anchor nodes", async () => {
  const resolution = await readJson("authoring/migration/owner-map-resolution-2026-08-29.json");
  const amendments = await readJson("guides/owner-amendments.json");
  const manifest = await readJson("guides/manifest.json");
  const overlays = await readJson("authoring/overlays/inner-child.overlay.json");
  assert.equal(resolution.decisions.find((item) => item.id === "OWNER.MAP.RESOLUTION.2026-08-29.D09").statement, d09Statement);
  assert.deepEqual(amendments.items.filter((item) => item.id === amendmentId), [{ id: amendmentId, domain: "inner-child", status: "owner-approved", text: d09Statement }]);
  assert.equal(manifest.sources.find((item) => item.id === "owner-amendments").version, amendments.version);
  const section = bundle.sourceMaps.find((item) => item.guideId === "owner-amendments").sections.find((item) => item.id === amendmentId);
  assert.equal(section.excerpt, d09Statement);
  const overlay = overlays.items.find((item) => item.id === "OVERLAY.IC.NONPUNITIVE_REVIEW");
  assert.equal(overlay.status, "reconciled");
  assert.deepEqual(overlay.reconciledNodeIds, reviewNodes);
  for (const id of reviewNodes) assert.ok(node(id).sourceRefs.includes(amendmentId), `${id} cites D09`);
});

test("the owner-approved wording is compiled exactly and appended without disturbing current node content", () => {
  const apprentice = node("IC.ADULT_APPRENTICE");
  const credibility = node("IC.CREDIBILITY_REPAIR");
  const protector = node("IC.PROTECTOR_ACTION");
  assert.equal(apprentice.recommendations.at(-1), reviewLine);
  assert.equal(apprentice.avoid.at(-1), avoidPunitive);
  assert.equal(apprentice.successSignals.at(-1), successSignal);
  assert.equal(apprentice.effects.requiredNuance.at(-1), accountabilityNuance);
  assert.equal(credibility.recommendations.at(-1), repairLine);
  assert.equal(credibility.avoid.at(-1), avoidWorthVerdict);
  assert.equal(credibility.effects.requiredNuance.at(-1), credibilityNuance);
  assert.equal(protector.recommendations.at(-1), reviewLine);
  assert.equal(protector.avoid.at(-1), avoidPunitive);
  // The owner rejected a credibility success-signal addition in the 2026-08-29 review.
  assert.deepEqual(credibility.successSignals, ["Promises and actions begin to align; an adverse track record starts accumulating credible counterevidence without demanding immediate trust."]);
  // PR #80 reparenting refinement content is preserved.
  assert.ok(apprentice.recommendations.includes("Carry the borrowed function into one ordinary-life act that the person initiates, then review what it actually contributed rather than treating completion alone as success."));
  assert.ok(credibility.avoid.includes("Do not call a temporary ceasefire or simple non-retaliation completed nurture, and do not demand trust as payment for it."));
  // Activation, routing and questions are unchanged by D09.
  for (const id of reviewNodes) assert.equal(node(id).defaultQuestion, "");
});

test("no review cadence, grading, or superseded draft wording enters the map", () => {
  const serialized = JSON.stringify(bundle.graphs);
  for (const wording of [
    "every morning", "every evening", "each evening", "daily review", "review score", "grade yourself",
    "After an ordinary-life attempt, review what was recognized",
    "When a promise was missed, name it",
    "Do not use review to stage an internal trial",
    "Review tracks kept promises and completed repairs as evidence alongside lapses",
    "Missed promises are evidence to address through acknowledgement"
  ]) assert.equal(serialized.toLowerCase().includes(wording.toLowerCase()), false, wording);
});

test("supported apprenticeship carries non-punitive review as context, not an extra required exercise", async () => {
  const result = plan(await proposalCase("G039"));
  assert.equal(result.primaryJob.id, "IC.BORROW_ONE_FUNCTION");
  const apprentice = result.selectedNodes.find((item) => item.id === "IC.ADULT_APPRENTICE");
  assert.ok(apprentice.recommendations.includes(reviewLine));
  assert.ok(result.avoid.includes(avoidPunitive));
  assert.ok(result.requiredNuance.includes(accountabilityNuance));
  assert.deepEqual(result.executionContract.requiredNodeIds, ["IC.BORROW_ONE_FUNCTION"]);
  assert.equal(result.nextQuestion, "");
});

test("credibility repair keeps the lapse real without a verdict about worth", async () => {
  const result = plan(await proposalCase("G040"));
  assert.equal(result.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.ok(result.selectedNodes.find((item) => item.id === "IC.CREDIBILITY_REPAIR").recommendations.includes(repairLine));
  assert.ok(result.avoid.includes(avoidWorthVerdict));
  assert.ok(result.requiredNuance.includes(credibilityNuance));
  assert.ok(result.requiredNuance.some((item) => item.includes("adverse track record")));
});

test("ordinary protector action without a helper still reviews without self-judgment", async () => {
  const result = plan(await proposalCase("G041"));
  const selected = result.selectedNodes.map((item) => item.id);
  assert.ok(selected.includes("IC.PROTECTOR_ACTION"));
  assert.equal(selected.includes("IC.ADULT_APPRENTICE"), false);
  assert.equal(selected.includes("IC.CREDIBILITY_REPAIR"), false);
  assert.ok(result.selectedNodes.find((item) => item.id === "IC.PROTECTOR_ACTION").recommendations.includes(reviewLine));
  assert.ok(result.avoid.includes(avoidPunitive));
});

test("realization receives the constraints but a review-cadence question cannot be appended", async () => {
  const result = plan(await proposalCase("G039"));
  const adjudication = {
    answer: "", what_is_clear: [], uncertainties: [], next_question: result.nextQuestion,
    accepted_insights: [...result.requiredNuance, ...result.selectedNodes.flatMap((item) => item.recommendations ?? [])],
    rejected_claims: [...result.forbiddenOverclaims, ...result.avoid], safety_flags: [], decision_summary: "Review without a trial."
  };
  const prompt = realizationPrompt({ userMessage: "I tried to look after myself this week and want to go over it.", recentTranscript: "", interventionContract: result }, adjudication, "synthetic");
  assert.match(prompt.system, /Give one main next move/);
  assert.ok(prompt.user.includes(avoidPunitive));
  assert.ok(prompt.user.includes(reviewLine));
  const answer = "Look at what you tried without putting yourself on trial: notice what felt right and what you could do better next time.";
  const realized = enforceResponseContract({
    answer: `${answer}\n\nShould you review yourself every morning and evening?`,
    next_question: "Should you review yourself every morning and evening?",
    realized_nodes: [{ id: result.primaryJob.id, evidence_quote: answer }]
  }, { plan: result, adjudication });
  assert.equal(realized.answer, answer);
  assert.equal(realized.next_question, "");
});
