import test from "node:test";
import assert from "node:assert/strict";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";

function plan(trace, primary = "IC.SAFETY") {
  return {
    primaryJob: { id: primary, title: "Synthetic", tier: primary === "IC.SAFETY" ? 1 : 2 },
    executionContract: { version: 1, requiredNodeIds: [primary] },
    pathPerformanceContract: { version: 1, prohibit_prior_exercise: false },
    pathPerformance: trace,
    questionContract: { mode: "none", question: "", source: null }
  };
}
function result(answer, primary, policy = []) {
  return {
    answer, next_question: "",
    realized_nodes: [
      { id: primary, evidence_quote: answer },
      ...policy.map(id => ({ id, evidence_quote: answer }))
    ]
  };
}
const paused = {
  route: "safety", reason: "Immediate protection controls this turn.", decision: "STOP_DEESCALATE",
  relational_readiness: { status: "PAUSE_ROMANCE", supportProgress: "REQUIRES_OBSERVED_BENEFIT" },
  goal_substitution: { romance_pause: true, narrow_romance_pause: false, instrumental_socializing: false }
};

test("higher-priority safety does not force the response to re-announce a romance pause", () => {
  const answer = "Focus only on immediate safety and getting reliable support around you right now.";
  const checked = enforceResponseContract(result(answer, "IC.SAFETY"), { plan: plan(paused) });
  assert.deepEqual(checked.responseContract.relationalPolicyMarkersRequired, []);
  assert.equal(checked.responseContract.pathPerformanceAdherencePassed, true);
});

test("when the romance pause itself controls the outward route, its grounded marker is required", () => {
  const trace = { ...paused, route: "action", decision: "SWITCH", reason: "Current foreseeable-harm/readiness evidence requires pausing active romance-seeking while widening non-romantic support." };
  const p = plan(trace, "ROUTE.ACT_OUTWARD");
  const answer = "For now, pause active romance-seeking while you build support that does not depend on getting a partner.";
  const missing = enforceResponseContract(result(answer, "ROUTE.ACT_OUTWARD"), { plan: p });
  assert.deepEqual(missing.responseContract.relationalPolicyMarkersRequired, ["POLICY.RELATIONAL_PAUSE"]);
  assert.equal(missing.responseContract.pathPerformanceAdherencePassed, false);
  const grounded = enforceResponseContract(result(answer, "ROUTE.ACT_OUTWARD", ["POLICY.RELATIONAL_PAUSE"]), { plan: p });
  assert.equal(grounded.responseContract.pathPerformanceAdherencePassed, true);
});

test("not-blocked readiness prevents an invented pause without requiring repetitive permission copy", () => {
  const trace = {
    route: "continue", reason: "The current strategy is moving.", decision: "CONTINUE",
    relational_readiness: { status: "NOT_BLOCKED", supportProgress: "REQUIRES_OBSERVED_BENEFIT" },
    goal_substitution: { romance_pause: false, narrow_romance_pause: false, instrumental_socializing: false }
  };
  const p = plan(trace, "IC.DEEP_CHILD_DIALOGUE");
  const answer = "Stay with the current useful process and see whether the change transfers into ordinary life.";
  const ordinary = enforceResponseContract(result(answer, "IC.DEEP_CHILD_DIALOGUE"), { plan: p });
  assert.deepEqual(ordinary.responseContract.relationalPolicyMarkersRequired, []);
  assert.equal(ordinary.responseContract.pathPerformanceAdherencePassed, true);
  const wrong = enforceResponseContract(result(answer, "IC.DEEP_CHILD_DIALOGUE", ["POLICY.RELATIONAL_PAUSE"]), { plan: p });
  assert.equal(wrong.responseContract.pathPerformanceAdherencePassed, false);
});
