import test from "node:test";
import assert from "node:assert/strict";

import { CASE_VARIABLE_ENUMS, blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables } from "../src/guide-graph/planner.mjs";
import { runCaseExtraction } from "../src/case-formulation/run.mjs";
import {
  createEmptyCaseState,
  diffCaseStates,
  mergeRuntimeSnapshotIntoCaseState,
  projectCaseStateForInspection,
  validateCaseState
} from "../src/case-state/longitudinal-state.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";

const snapshot = (supportMode = "unknown", currentMode = "unknown") => ({
  user_goal: "synthetic continuity",
  current_issue: "synthetic issue",
  variables: { ...blankCaseVariables(), support_mode_preference: supportMode, support_mode_current: currentMode },
  direct_observations: [],
  hypotheses: []
});

test("new practical-action and support-mode enums are bounded and default unknown", () => {
  assert.deepEqual(CASE_VARIABLE_ENUMS.practical_action_state, ["action_available", "blocked_waiting", "resolved", "unknown"]);
  assert.deepEqual(CASE_VARIABLE_ENUMS.support_mode_preference, ["listen", "untangle", "advice", "mixed", "unknown"]);
  assert.deepEqual(CASE_VARIABLE_ENUMS.support_mode_current, ["listen", "untangle", "advice", "mixed", "unknown"]);
  const variables = blankCaseVariables();
  assert.equal(variables.practical_action_state, "unknown");
  assert.equal(variables.support_mode_preference, "unknown");
  assert.equal(variables.support_mode_current, "unknown");
});

test("explicit support mode persists in longitudinal state until the person changes it", () => {
  const empty = createEmptyCaseState({ caseId: "synthetic-support-mode" });
  assert.equal(empty.support_mode_preference, "unknown");

  const advice = mergeRuntimeSnapshotIntoCaseState(empty, snapshot("advice"), { turnId: "T1" });
  assert.equal(advice.support_mode_preference, "advice");
  assert.equal(projectCaseStateForInspection(advice).supportModePreference, "advice");

  const silent = mergeRuntimeSnapshotIntoCaseState(advice, snapshot("unknown"), { turnId: "T2" });
  assert.equal(silent.support_mode_preference, "advice", "unknown on a later turn must not erase an explicit preference");

  const oneTurnOverride = mergeRuntimeSnapshotIntoCaseState(silent, snapshot("unknown", "listen"), { turnId: "T3" });
  assert.equal(oneTurnOverride.support_mode_preference, "advice", "a current-turn override must not overwrite the durable baseline");

  const changed = mergeRuntimeSnapshotIntoCaseState(oneTurnOverride, snapshot("listen", "listen"), { turnId: "T4" });
  assert.equal(changed.support_mode_preference, "listen");
  assert.equal(diffCaseStates(silent, changed).support_mode_preference_changed, true);
});

test("derived variables use the durable preference as the current mode when there is no turn override", () => {
  const inherited = deriveCaseVariables({ ...blankCaseVariables(), support_mode_preference: "advice", support_mode_current: "unknown" });
  assert.equal(inherited.support_mode_preference, "advice");
  assert.equal(inherited.support_mode_current, "advice");

  const overridden = deriveCaseVariables({ ...blankCaseVariables(), support_mode_preference: "advice", support_mode_current: "listen" });
  assert.equal(overridden.support_mode_preference, "advice");
  assert.equal(overridden.support_mode_current, "listen");
});

test("case extraction mechanically carries the stored baseline while preserving a one-turn override", async () => {
  const value = {
    user_goal: "synthetic continuity",
    current_issue: "synthetic issue",
    variables: { ...blankCaseVariables(), support_mode_preference: "unknown", support_mode_current: "listen" },
    direct_observations: [],
    hypotheses: [],
    unknowns: []
  };
  const provider = { id: "synthetic", model: "synthetic", async generate() { return { text: JSON.stringify(value) }; } };
  const result = await runCaseExtraction({
    context: {
      guideManifest: { version: "synthetic" },
      guideExcerpts: "",
      userFacts: [],
      userMessage: "For this turn, just listen.",
      recentTranscript: "",
      durableCaseState: { support_mode_preference: "advice" },
      pathPerformanceEnabled: false,
      perspectivePracticesEnabled: false
    },
    provider
  });
  assert.equal(result.value.variables.support_mode_preference, "advice");
  assert.equal(result.value.variables.support_mode_current, "listen");
});

test("historical case state without support mode remains valid", () => {
  const historical = createEmptyCaseState({ caseId: "synthetic-historical" });
  delete historical.support_mode_preference;
  assert.doesNotThrow(() => validateCaseState(historical));
});

test("extractor is told to preserve durable support mode and distinguish blocked waiting", () => {
  const state = createEmptyCaseState({ caseId: "synthetic-prompt" });
  state.support_mode_preference = "advice";
  const prompt = caseExtractionPrompt({
    guideManifest: { version: "synthetic" },
    guideExcerpts: "",
    userFacts: [],
    userMessage: "Synthetic current turn.",
    recentTranscript: "",
    durableCaseState: state,
    currentTherapeuticEpisode: null,
    trackerWindow: null,
    targetedRetrievalRequests: [],
    targetedOlderEvidence: [],
    priorCaseSnapshot: null,
    priorInterventionContract: null,
    pathPerformanceEnabled: false,
    perspectivePracticesEnabled: false
  });
  assert.match(prompt.system, /practical_action_state is scoped to the selected practical focus/u);
  assert.match(prompt.system, /blocked_waiting only when all currently relevant next steps for that selected focus are blocked/u);
  assert.match(prompt.system, /blocked sibling lane and its reopening condition/u);
  assert.match(prompt.system, /Recompute practical_action_state when the selected practical focus changes/u);
  assert.match(prompt.system, /support_mode_preference is the durable baseline/u);
  assert.match(prompt.system, /support_mode_current is the effective mode for this turn/u);
  assert.match(prompt.system, /Never infer either support-mode field from gender/u);
  assert.match(prompt.user, /"support_mode_preference": "advice"/u);
});
