import test from "node:test";
import assert from "node:assert/strict";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";

function baseVariables(overrides = {}) {
  return {
    present_safety: "safe",
    orientation: "oriented",
    ability_to_stop: "yes",
    ability_to_return: "yes",
    dissociation: "none",
    altered_state: "sober",
    memory_source_risk: "absent",
    current_intent: "conversation",
    protective_response: "absent",
    self_directed_love: "safe",
    credibility_conflict: "absent",
    inner_adult_access: "available",
    activation: "low",
    age_agency_ambiguity: "absent",
    resentment_toward_younger_self: "absent",
    target_type: "none",
    ...overrides
  };
}

test("ordinary low-ambiguity conversation routes to fast graph mode", () => {
  const routing = classifyTherapyTier({ variables: baseVariables(), unknowns: [] }, "auto");
  assert.equal(routing.tier, "fast");
});

test("moderate protective ambiguity routes to reviewed mode", () => {
  const routing = classifyTherapyTier({
    variables: baseVariables({ dissociation: "mild", protective_response: "present", activation: "moderate" }),
    unknowns: []
  }, "auto");
  assert.equal(routing.tier, "reviewed");
});

test("credibility plus resentment plus age ambiguity routes to compact deep review on a first turn", () => {
  const routing = classifyTherapyTier({
    variables: baseVariables({ credibility_conflict: "present", resentment_toward_younger_self: "present", age_agency_ambiguity: "present" }),
    unknowns: []
  }, "auto");
  assert.equal(routing.tier, "deep");
});

test("a narrow follow-up to an already deep-reviewed formulation steps down to reviewed mode", () => {
  const prior = { variables: baseVariables({ credibility_conflict: "present", resentment_toward_younger_self: "present", age_agency_ambiguity: "present" }) };
  const now = { variables: { ...prior.variables, activation: "moderate" }, unknowns: [] };
  const routing = classifyTherapyTier(now, "auto", { priorCaseSnapshot: prior, priorProcessingTier: "deep" });
  assert.equal(routing.tier, "reviewed");
  assert.equal(routing.deltaCount, 1);
});

test("safety-sensitive state cannot be forced into fast mode and uses forensic council", () => {
  const routing = classifyTherapyTier({ variables: baseVariables({ present_safety: "unsafe" }), unknowns: [] }, "fast");
  assert.equal(routing.tier, "forensic");
  assert.equal(routing.forced, true);
});

test("explicit deep and forensic selections remain distinct", () => {
  const snapshot = { variables: baseVariables(), unknowns: [] };
  assert.equal(classifyTherapyTier(snapshot, "deep").tier, "deep");
  assert.equal(classifyTherapyTier(snapshot, "forensic").tier, "forensic");
  assert.equal(classifyTherapyTier(snapshot, "adversarial").tier, "deep");
});

test("fully structured credibility ambiguity can use reviewed mode instead of Opus deep analysis", () => {
  const routing = classifyTherapyTier({
    variables: baseVariables({
      credibility_conflict: "present",
      credibility_evidence_state: "adverse",
      internal_speaker_relation: "unresolved",
      witness_capacity: "present",
      resentment_toward_younger_self: "present",
      age_agency_ambiguity: "present",
      self_directed_love: "unsafe",
      protective_response: "present",
      activation: "moderate"
    }),
    unknowns: [{ variable: "age_agency_ambiguity", question: "Which age or version is being blamed?", importance: 5 }]
  }, "auto");
  assert.equal(routing.tier, "reviewed");
  assert.match(routing.reason, /graph-structured/i);
});
