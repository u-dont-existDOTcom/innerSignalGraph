import test from "node:test";
import assert from "node:assert/strict";

import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { longitudinalClinicalRules, sharedClinicalRules } from "../src/prompts/common.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

test("longitudinal rules preserve client phenomenology without granting causal authority", () => {
  assert.match(longitudinalClinicalRules, /privileged evidence about phenomenology/u);
  assert.match(longitudinalClinicalRules, /automatically authoritative about cause/u);
  assert.match(longitudinalClinicalRules, /salience, importance, and centrality separate/u);
  assert.match(longitudinalClinicalRules, /Preserve the established longitudinal target/u);
});

test("longitudinal rules switch a failed probe instead of inventing or abandoning the target", () => {
  assert.match(longitudinalClinicalRules, /Failure of a probe is evidence about the probe/u);
  assert.match(longitudinalClinicalRules, /do not invent words, beliefs, or speaker identity/u);
  assert.match(longitudinalClinicalRules, /triggers, body experience, action tendencies/u);
  assert.match(longitudinalClinicalRules, /Abandon the target only when evidence actually undermines it/u);
});

test("longitudinal rules keep differentiation and expulsion as distinct hypotheses", () => {
  assert.match(longitudinalClinicalRules, /increased differentiation\/awareness/u);
  assert.match(longitudinalClinicalRules, /increasing alienation\/expulsion/u);
  assert.match(longitudinalClinicalRules, /curious, inclusive, and workable/u);
  assert.match(longitudinalClinicalRules, /rejecting, eradication-focused, and alienated/u);
});

test("longitudinal rules detect inadequate examples, repeated questions, and client-generated hypotheses", () => {
  assert.match(longitudinalClinicalRules, /does not obviously instantiate an earlier high-stakes description/u);
  assert.match(longitudinalClinicalRules, /Do not re-ask known information/u);
  assert.match(longitudinalClinicalRules, /client-generated functional hypothesis more evidential priority/u);
  assert.match(longitudinalClinicalRules, /what observation would count against the hypothesis/u);
  assert.match(longitudinalClinicalRules, /self-love, self-respect, or reduced self-rejection/u);
});

test("longitudinal rules preserve constraint chains, support mode, nonrepetitive advice, and low-interpretation memory support", () => {
  assert.match(longitudinalClinicalRules, /A real problem can be blocked rather than actionable now/u);
  assert.match(longitudinalClinicalRules, /known external prerequisite/u);
  assert.match(longitudinalClinicalRules, /practical_action_state is scoped to that selected practical focus/u);
  assert.match(longitudinalClinicalRules, /blocked lane does not suppress another current priority/u);
  assert.match(longitudinalClinicalRules, /cannot focus, everything feels scrambled/u);
  assert.match(longitudinalClinicalRules, /Do not spend the response reciting facts they just supplied/u);
  assert.match(longitudinalClinicalRules, /durable conversational preference/u);
  assert.match(longitudinalClinicalRules, /do not re-ask on later turns/u);
  assert.match(longitudinalClinicalRules, /Before repeating advice/u);
  assert.match(longitudinalClinicalRules, /Distinguish reflective journaling from external memory support/u);
  const prompt = realizationPrompt(
    { userMessage: "Synthetic current turn asks to listen.", recentTranscript: "Synthetic prior advice.", interventionContract: { variables: { support_mode_preference: "advice", support_mode_current: "listen", practical_action_state: "blocked_waiting" } } },
    {},
    "synthetic"
  );
  assert.match(prompt.system, /support_mode_current is the effective mode for this turn/u);
  assert.match(prompt.system, /durable support_mode_preference is the fallback baseline/u);
  assert.match(prompt.system, /Treat known practical constraints as binding context/u);
  assert.match(prompt.system, /practical_action_state applies to the selected practical focus/u);
  assert.match(prompt.system, /one blocked lane must not suppress another feasible one/u);
  assert.match(prompt.system, /Untangling must add structure/u);
  assert.match(prompt.system, /include a concrete recommendation rather than substituting reflection for advice/u);
  assert.match(prompt.system, /Use at most a short organizing recap/u);
  assert.match(prompt.system, /Do not re-deliver already-given advice as if it were new/u);
  assert.match(prompt.system, /simple factual log or voice note/u);
});

test("case audit receives the longitudinal invariants before routing", () => {
  const prompt = caseAuditPrompt(
    { recentTranscript: "Synthetic prior turn.", userMessage: "Synthetic current turn." },
    { observations: [], hypotheses: [] }
  );
  assert.match(prompt.system, /LONGITUDINAL REASONING RULES/u);
  assert.match(prompt.system, /client's appraisal that an event is minor/u);
  assert.match(prompt.system, /nonverbal critic, presence, shame state, or part/u);
  assert.match(prompt.system, /client-generated functional hypothesis/u);
  assert.match(prompt.system, /all relevant next steps for the selected practical focus are blocked by a known external prerequisite/u);
  assert.match(prompt.system, /practical_action_state being applied globally across several independent practical lanes/u);
  assert.match(prompt.system, /cognitive overload being answered with a long recap/u);
  assert.match(prompt.system, /explicit durable support-mode preference being lost/u);
  assert.match(prompt.system, /substantially identical advice being re-delivered/u);
  assert.match(prompt.system, /reflective journaling being prescribed again/u);
});

test("response realization receives the same longitudinal invariants", () => {
  const prompt = realizationPrompt(
    { userMessage: "Synthetic current turn.", recentTranscript: "Synthetic prior turn.", interventionContract: null },
    {},
    "synthetic"
  );
  assert.ok(sharedClinicalRules.includes(longitudinalClinicalRules));
  assert.match(prompt.system, /LONGITUDINAL REASONING RULES/u);
  assert.match(prompt.system, /latest salient detail/u);
  assert.match(prompt.system, /Do not either ignore it or confirm it/u);
});

test("public longitudinal policy remains general and de-identified", () => {
  assert.doesNotMatch(longitudinalClinicalRules, /private transcript|source conversation|real-person name|[$€£]\s*\d{3,}/iu);
});
