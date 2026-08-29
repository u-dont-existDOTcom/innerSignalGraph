import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { materializeProposal } from "../src/authoring/proposal-builder.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proposalId = "nonpunitive-review-r1";
let built;

test.before(async () => {
  built = await materializeProposal({ root, id: proposalId });
});

function node(id) {
  return built.candidateGraphs.flatMap((graph) => graph.nodes).find((item) => item.id === id);
}

function proposedCase(id) {
  return built.proposal.tests.find((item) => item.value.id === id).value;
}

test("the candidate changes only the five authorized fields on the two D09 nodes", () => {
  const actual = built.diff.changes.map((item) => `${item.entityId}.${item.fieldPath}`).sort();
  const expected = [
    "IC.ADULT_APPRENTICE.avoid",
    "IC.ADULT_APPRENTICE.effects.requiredNuance",
    "IC.ADULT_APPRENTICE.recommendations",
    "IC.ADULT_APPRENTICE.sourceRefs",
    "IC.ADULT_APPRENTICE.successSignals",
    "IC.CREDIBILITY_REPAIR.avoid",
    "IC.CREDIBILITY_REPAIR.effects.requiredNuance",
    "IC.CREDIBILITY_REPAIR.recommendations",
    "IC.CREDIBILITY_REPAIR.sourceRefs"
  ].sort();

  assert.deepEqual(built.diff.changedNodeIds, ["IC.ADULT_APPRENTICE", "IC.CREDIBILITY_REPAIR"]);
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(built.candidateGraphs).includes("COMMON_HUMANITY"), false);
});

test("G013 carries the exact user-facing wording and backend distinctions through the intervention contract", () => {
  const definition = proposedCase("G013");
  const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: built.candidateBundle.graphs });
  const apprentice = node("IC.ADULT_APPRENTICE");

  assert.equal(plan.primaryJob.id, "IC.BORROW_ONE_FUNCTION");
  assert(plan.selectedNodes.some((item) => item.id === "IC.ADULT_APPRENTICE"));
  assert.equal(plan.selectedNodes.some((item) => item.id === "IC.NEUTRAL_WITNESS"), false);
  assert.equal(plan.selectedNodes.some((item) => item.id === "IC.BORROW_LOVE"), false);
  assert(plan.requiredNuance.includes("Review distinguishes accountability and learning from punishment or judgments about worth. Accountability may still include consequences, firmer boundaries, and an honest assessment of present capacity."));
  assert(plan.avoid.includes("Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."));
  assert(apprentice.recommendations.includes("After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."));
  assert(apprentice.successSignals.includes("The review yields clearer understanding and either one bounded repair or adjustment, or a clear conclusion that no change is needed, without materially escalating self-attack."));
});

test("credibility cases preserve actual agreement, capacity, repair, kept commitments, and serious lapses", () => {
  for (const id of ["G001", "G012"]) {
    const definition = proposedCase(id);
    const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: built.candidateBundle.graphs });
    assert.equal(plan.primaryJob.id, "IC.CREDIBILITY_REPAIR");
    assert(plan.requiredNuance.includes("A missed commitment matters, but it is not the whole credibility picture. Consider what was actually agreed, present capacity and circumstances, acknowledgement and repair, and kept commitments—without using positive evidence to cancel or minimize a serious lapse."));
    assert(plan.avoid.includes("Do not turn a lapse or repeated pattern into a verdict about intrinsic worth. Review may still conclude that a particular commitment currently exceeds capacity or requires stronger limits, support, or a different plan."));
  }
  const credibility = node("IC.CREDIBILITY_REPAIR");
  assert(credibility.recommendations.includes("When an effort at improvement doesn’t go as hoped, name what happened, repair what can be repaired, and make the next promise more credible."));
  assert.deepEqual(credibility.successSignals, ["Promises and actions begin to align; an adverse track record starts accumulating credible counterevidence without demanding immediate trust."]);
});

test("backend constraints remain distinct from exact user-facing recommendations and preserve one main next move", () => {
  const definition = proposedCase("G013");
  const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: built.candidateBundle.graphs });
  const adjudication = {
    answer: "Review the attempt without prosecuting yourself.",
    what_is_clear: [],
    uncertainties: [],
    next_question: plan.nextQuestion,
    accepted_insights: [
      ...plan.requiredNuance,
      ...plan.selectedNodes.flatMap((item) => item.recommendations ?? [])
    ],
    rejected_claims: [...plan.forbiddenOverclaims, ...plan.avoid],
    safety_flags: [],
    decision_summary: "Keep accountability concrete and non-punitive."
  };
  const prompt = realizationPrompt({ userMessage: "I want to review how I did.", recentTranscript: "", interventionContract: plan }, adjudication, "Claude");

  assert.match(prompt.system, /Give one main next move/);
  assert.match(prompt.user, /Do not make review punitive, compulsive, or mandatory\./);
  assert.match(prompt.user, /consequences, firmer boundaries, and an honest assessment of present capacity/);

  const answer = "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time.";
  const realized = enforceResponseContract({
    answer,
    next_question: "What should I review every morning and evening?",
    realized_nodes: [
      { id: plan.primaryJob.id, evidence_quote: answer }
    ]
  }, { plan, adjudication });
  assert.equal(realized.answer, answer);
  assert.equal(realized.next_question, "");
  assert.equal(realized.answer.includes("tracking"), false);
  assert.equal(realized.answer.includes("intrinsic worth"), false);
});

test("superseded and rejected D09 wording is absent from the candidate", () => {
  const serialized = JSON.stringify(built.candidateGraphs);
  for (const wording of [
    "After an ordinary-life attempt, review what was recognized",
    "When a promise was missed, name it",
    "Do not use review to stage an internal trial",
    "Do not turn review into prosecution, grading, a trial",
    "Review distinguishes accountability and learning from punishment or a verdict on intrinsic worth",
    "The review yields one specific repair or next adjustment",
    "Review tracks kept promises and completed repairs as evidence alongside lapses",
    "Missed promises are evidence to address through acknowledgement"
  ]) assert.equal(serialized.includes(wording), false, wording);
});
