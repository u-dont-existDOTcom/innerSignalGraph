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
  assert.match(longitudinalClinicalRules, /self-love, self-respect, reduced self-rejection, or reparenting/u);
  assert.match(longitudinalClinicalRules, /If no, preserve it as background and continue upstream/u);
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