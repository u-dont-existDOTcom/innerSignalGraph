import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeClaudeAuthFailure,
  hypnosisRunHasClaudeAuthFailure,
  resolutionHasClaudeAuthFailure
} from "../src/autopilot/auth-recovery.mjs";

test("Claude auth detector catches expired OAuth refresh failures", () => {
  assert.equal(looksLikeClaudeAuthFailure({
    message: "Claude CLI exited with status 1.",
    details: { stderr: "OAuth token expired and refresh failed. Run claude auth login." }
  }), true);
});

test("Claude auth detector does not misclassify ordinary model failures", () => {
  assert.equal(looksLikeClaudeAuthFailure({
    message: "Claude CLI exited with status 1.",
    details: { stderr: "Model selector claude-not-real was not found" }
  }), false);
});

test("resolution and hypnosis helpers find nested Claude auth failures", () => {
  assert.equal(resolutionHasClaudeAuthFailure({
    attempts: { anthropic: [{ model: "claude-opus-5", ok: false, error: "authentication expired; claude auth login" }] }
  }), true);
  assert.equal(hypnosisRunHasClaudeAuthFailure({
    attempts: [{ error: { details: { stderr: "OAuth refresh failed" } } }]
  }), true);
});
