import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInternalFormulationMap,
  buildResponsePresentation,
  mapDebugForMode
} from "../src/orchestrator/response-presentation.mjs";

function formulation({ abilityToStop = "yes" } = {}) {
  return {
    snapshot: {
      variables: {
        present_safety: "safe",
        orientation: "oriented",
        ability_to_stop: abilityToStop,
        ability_to_return: "yes",
        suicidal_state: "absent",
        witness_capacity: "present",
        inner_adult_access: "partial",
        internal_speaker_relation: "unresolved",
        activation: "moderate",
        dissociation: "none",
        inward_attention_effect: "neutral",
        body_capacity: "adequate",
        freeze_pattern: "absent"
      },
      direct_observations: [{ id: "O1", statement: "The loop repeats.", evidence: "same computation" }],
      audit: { safety_flags: [] }
    },
    plan: {
      primaryJob: { id: "ROUTE.LEAVE_ALONE", title: "Leave the loop alone" },
      selectedNodes: [{ id: "ROUTE.LEAVE_ALONE", title: "Leave the loop alone", recommendations: [] }],
      displayTrace: { secondaryJobs: [], deferredNodes: [], blockedNodes: [] },
      requiredNuance: ["Do not make non-engagement into a dogma."],
      forbiddenOverclaims: ["Do not deny a concrete problem."],
      avoid: [],
      questionContract: { question: "", source: null }
    },
    routing: { tier: "reviewed", reason: "attention-loop routing", forced: false }
  };
}

test("default and map-debug modes share one internal map while only debug exposes it", () => {
  const input = formulation();
  const internalMap = buildInternalFormulationMap(input);
  const concise = buildResponsePresentation({ responseMode: "default", internalMap });
  const debug = buildResponsePresentation({ responseMode: "map-debug", internalMap });
  assert.equal(concise.leaveAloneBrevity, true);
  assert.equal(concise.maxAnswerParagraphs, 1);
  assert.equal(mapDebugForMode("default", internalMap), undefined);
  assert.equal(debug.maxAnswerParagraphs, concise.maxAnswerParagraphs);
  assert.equal(mapDebugForMode("map-debug", internalMap), internalMap);
  assert.equal(internalMap.threeWayRouting.winningRoute.id, "ROUTE.LEAVE_ALONE");
  assert.equal(internalMap.nextQuestionLogic.question, "");
});

test("safety precedence suppresses a lower-priority leave-alone presentation", () => {
  const input = formulation({ abilityToStop: "no" });
  const internalMap = buildInternalFormulationMap(input);
  const presentation = buildResponsePresentation({ responseMode: "default", internalMap });
  assert.equal(internalMap.safetyRouting.precedenceApplied, true);
  assert.equal(internalMap.threeWayRouting.safetySuppressed, true);
  assert.equal(internalMap.threeWayRouting.winningRoute, null);
  assert.ok(internalMap.threeWayRouting.rejectedRoutes.every((item) => /safety precedence/i.test(item.reason)));
  assert.equal(presentation.safetyOverride, true);
  assert.equal(presentation.leaveAloneBrevity, false);
  assert.equal(presentation.maxAnswerParagraphs, 5);
});
