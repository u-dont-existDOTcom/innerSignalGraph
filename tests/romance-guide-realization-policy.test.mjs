import test from "node:test";
import assert from "node:assert/strict";
import { realizationPrompt } from "../src/prompts/realize.mjs";

function prompt() {
  return realizationPrompt({
    userMessage: "I have a relationship question.", recentTranscript: "", autopilotFeedback: null,
    interventionContract: { variables: {}, pathPerformance: null }
  }, { answer: "", what_is_clear: [], uncertainties: [], next_question: "", accepted_insights: [], rejected_claims: [], safety_flags: [], decision_summary: "" }, "test-renderer");
}

test("realizer contains the owner-confirmed optional romance guide reference", () => {
  const { system } = prompt();
  assert.ok(system.includes("https://romance.u-dont-exist.com"));
  assert.match(system, /deterministic romanceGuide trace owns the optional reference decision/);
  assert.match(system, /OFFER_OPTIONAL_REFERENCE/);
  assert.match(system, /POLICY\.ROMANCE_GUIDE_REFERENCE/);
});

test("optional reference cannot replace safety, stabilization or current help", () => {
  const { system } = prompt();
  assert.match(system, /Do not surface it during immediate safety\/stabilization/);
  assert.match(system, /Never substitute reading the guide for the help needed now/);
  assert.match(system, /medical, contraceptive, anatomical, or psychedelic-treatment claims/);
});

test("optional reference is bounded for audience, repetition and consent", () => {
  const { system } = prompt();
  assert.match(system, /For every other reference decision, do not mention or link/);
  assert.match(system, /after the user declined it/);
  assert.match(system, /repeatedly after it was already offered/);
});
