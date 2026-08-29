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
    "IC.CREDIBILITY_REPAIR.sourceRefs",
    "IC.CREDIBILITY_REPAIR.successSignals"
  ].sort();

  assert.deepEqual(built.diff.changedNodeIds, ["IC.ADULT_APPRENTICE", "IC.CREDIBILITY_REPAIR"]);
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(built.candidateGraphs).includes("COMMON_HUMANITY"), false);
});

test("G013 carries non-punitive review through the deterministic intervention contract", () => {
  const definition = proposedCase("G013");
  const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: built.candidateBundle.graphs });
  const apprentice = node("IC.ADULT_APPRENTICE");

  assert.equal(plan.primaryJob.id, "IC.BORROW_ONE_FUNCTION");
  assert(plan.selectedNodes.some((item) => item.id === "IC.ADULT_APPRENTICE"));
  assert.equal(plan.selectedNodes.some((item) => item.id === "IC.NEUTRAL_WITNESS"), false);
  assert.equal(plan.selectedNodes.some((item) => item.id === "IC.BORROW_LOVE"), false);
  assert(plan.requiredNuance.includes("Review distinguishes accountability and learning from punishment or a verdict on intrinsic worth."));
  assert(plan.avoid.includes("Do not turn review into prosecution, grading, a trial, or a mandatory morning/evening ritual."));
  assert(apprentice.recommendations.includes("After an ordinary-life attempt, review what was recognized, what was repaired, which promises were kept or missed, and one thing to change next."));
  assert(apprentice.successSignals.includes("The review yields one specific repair or next adjustment without escalating self-attack."));
});

test("credibility cases preserve misses, repair, kept promises, and successful repair as balanced evidence", () => {
  for (const id of ["G001", "G012"]) {
    const definition = proposedCase(id);
    const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: built.candidateBundle.graphs });
    assert.equal(plan.primaryJob.id, "IC.CREDIBILITY_REPAIR");
    assert(plan.requiredNuance.includes("Missed promises are evidence to address through acknowledgement, repair, and changed behavior; kept promises and successful repairs are evidence too."));
    assert(plan.avoid.includes("Do not use review to stage an internal trial or turn one lapse into a final verdict about worth or future capacity."));
  }
  const credibility = node("IC.CREDIBILITY_REPAIR");
  assert(credibility.recommendations.includes("When a promise was missed, name it, repair what can be repaired, and make the next promise more credible rather than demanding acquittal or issuing a global verdict."));
  assert(credibility.successSignals.includes("Review tracks kept promises and completed repairs as evidence alongside lapses."));
});

test("the realization contract rejects trial, worth-verdict, and fixed-cadence framing while preserving one main next move", () => {
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
  assert.match(prompt.user, /Do not turn review into prosecution, grading, a trial, or a mandatory morning\/evening ritual\./);
  assert.match(prompt.user, /punishment or a verdict on intrinsic worth/);

  const answer = "Notice one kept promise, name one miss without making it a verdict on your worth, repair what can be repaired, and choose one adjustment for the next attempt.";
  const realized = enforceResponseContract({
    answer,
    next_question: "What should I review every morning and evening?",
    realized_nodes: [
      { id: plan.primaryJob.id, evidence_quote: answer }
    ]
  }, { plan, adjudication });
  assert.equal(realized.answer, answer);
  assert.equal(realized.next_question, "");
  assert.equal(realized.answer.includes("morning and evening"), false);
});
