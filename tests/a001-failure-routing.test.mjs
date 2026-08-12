import test from "node:test";
import assert from "node:assert/strict";
import {
  decideA001FailureRoute,
  buildA001StageTerminal
} from "../src/autopilot/a001-stage-recovery.mjs";

function auditFailure(overrides = {}) {
  return {
    stage: "case_audit",
    role: "auditor",
    provider: "openai",
    model: "gpt-5.6-sol",
    classification: "TRANSIENT",
    retryable: true,
    actionCode: null,
    message: "openai/gpt-5.6-sol case_audit encountered a transient provider or transport failure.",
    code: "PROVIDER_ERROR",
    exitStatus: 1,
    occurredAt: "2026-08-12T00:00:00.000Z",
    ...overrides
  };
}

test("the observed Codex case-audit failure can never route to Fable", () => {
  const decision = decideA001FailureRoute({
    failure: auditFailure(),
    result: null,
    acceptance: null,
    fableEnabled: true,
    primaryAnthropicModel: "claude-opus-5"
  });
  assert.equal(decision.kind, "TERMINAL_STAGE_FAILURE");
  assert.equal(decision.failure.provider, "openai");
  assert.equal(decision.failure.stage, "case_audit");
});

test("Fable remains available for a completed result that fails reasoning acceptance", () => {
  const decision = decideA001FailureRoute({
    failure: null,
    result: { mode: "deep" },
    acceptance: { ok: false, plan: { missing: ["required insight"] } },
    fableEnabled: true,
    primaryAnthropicModel: "claude-opus-5"
  });
  assert.equal(decision.kind, "FABLE_REASONING_ESCALATION");
});

test("an exhausted retryable audit becomes a named resumable blocker", () => {
  const terminal = buildA001StageTerminal(auditFailure(), { checkpointAvailable: true });
  assert.equal(terminal.status, "BLOCKED");
  assert.equal(terminal.stage, "A001-case-audit");
  assert.equal(terminal.exitCode, 1);
  assert.equal(terminal.details.failure.classification, "TRANSIENT");
  assert.equal(terminal.details.failure.model, "gpt-5.6-sol");
  assert.match(terminal.nextAction, /completed Claude extraction is saved/i);
  assert.match(terminal.nextAction, /resume/i);
  assert.doesNotMatch(JSON.stringify(terminal), /uncaught-error/i);
});

test("Codex authentication failure requests one automatic browser-login recovery", () => {
  const terminal = buildA001StageTerminal(auditFailure({
    classification: "AUTH_REQUIRED",
    retryable: false,
    actionCode: "CODEX_REAUTH",
    message: "openai/gpt-5.6-sol case_audit requires renewed local CLI authentication."
  }), { checkpointAvailable: true });
  assert.equal(terminal.status, "ACTION_REQUIRED");
  assert.equal(terminal.stage, "A001-case-audit");
  assert.equal(terminal.exitCode, 2);
  assert.equal(terminal.details.actionCode, "CODEX_REAUTH");
  assert.match(terminal.nextAction, /browser sign-in/i);
});

test("Fable does not loop when it is already the primary Anthropic model", () => {
  const decision = decideA001FailureRoute({
    failure: null,
    result: null,
    acceptance: null,
    fableEnabled: true,
    primaryAnthropicModel: "claude-fable-5"
  });
  assert.equal(decision.kind, "NO_ESCALATION");
});
