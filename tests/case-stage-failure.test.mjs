import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError, ValidationError } from "../src/core/errors.mjs";
import {
  CaseStageError,
  asCaseStageError,
  safeCaseStageFailure,
  isCaseAuditFailure
} from "../src/case-formulation/stage-failure.mjs";
import { runCaseAudit } from "../src/case-formulation/run.mjs";

const codex = { id: "openai", model: "gpt-5.6-sol" };

function stageFailure(cause) {
  return asCaseStageError(cause, { stage: "case_audit", provider: codex });
}

test("case-stage failures classify retryable and deterministic Codex causes", () => {
  const cases = [
    {
      cause: new ProviderError("Codex CLI case_audit timed out after 900000 ms."),
      classification: "TRANSIENT",
      retryable: true,
      actionCode: null
    },
    {
      cause: new ProviderError("Codex CLI exited with status 1.", { details: { stderr: "429 rate limit exceeded" } }),
      classification: "TRANSIENT",
      retryable: true,
      actionCode: null
    },
    {
      cause: new ValidationError("openai case_audit was not valid JSON."),
      classification: "STRUCTURED_RESULT",
      retryable: true,
      actionCode: null
    },
    {
      cause: new ProviderError("Codex CLI exited with status 1.", { details: { stderr: "401 Unauthorized: token expired" } }),
      classification: "AUTH_REQUIRED",
      retryable: false,
      actionCode: "CODEX_REAUTH"
    },
    {
      cause: new ProviderError("Codex CLI exited with status 1.", { details: { stderr: "Model gpt-5.6-sol is unavailable for this account" } }),
      classification: "MODEL_UNAVAILABLE",
      retryable: false,
      actionCode: null
    },
    {
      cause: new ProviderError("Installed Codex CLI lacks required structured-output flags.", { code: "CLI_INCOMPATIBLE" }),
      classification: "CLI_INCOMPATIBLE",
      retryable: false,
      actionCode: null
    },
    {
      cause: new ProviderError("Codex CLI exited with status 17."),
      classification: "PROVIDER_FAILURE",
      retryable: false,
      actionCode: null
    }
  ];

  for (const expected of cases) {
    const safe = safeCaseStageFailure(stageFailure(expected.cause));
    assert.equal(safe.stage, "case_audit");
    assert.equal(safe.role, "auditor");
    assert.equal(safe.provider, "openai");
    assert.equal(safe.model, "gpt-5.6-sol");
    assert.equal(safe.classification, expected.classification);
    assert.equal(safe.retryable, expected.retryable);
    assert.equal(safe.actionCode, expected.actionCode);
    assert.match(safe.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test("safe case-stage failure never copies raw provider or clinical details", () => {
  const cause = new ProviderError("Codex CLI exited with status 1.", {
    details: {
      stderr: "STDERR_PRIVATE_SENTINEL",
      stdout: "STDOUT_PRIVATE_SENTINEL",
      prompt: "PROMPT_PRIVATE_SENTINEL",
      transcript: "TRANSCRIPT_PRIVATE_SENTINEL",
      responseText: "RESPONSE_PRIVATE_SENTINEL",
      accessToken: "TOKEN_PRIVATE_SENTINEL"
    }
  });
  const safeText = JSON.stringify(safeCaseStageFailure(stageFailure(cause)));
  for (const sentinel of ["STDERR_PRIVATE_SENTINEL", "STDOUT_PRIVATE_SENTINEL", "PROMPT_PRIVATE_SENTINEL", "TRANSCRIPT_PRIVATE_SENTINEL", "RESPONSE_PRIVATE_SENTINEL", "TOKEN_PRIVATE_SENTINEL"]) {
    assert.doesNotMatch(safeText, new RegExp(sentinel));
  }
});

test("runCaseAudit attributes a provider exception to the exact audit role", async () => {
  const cause = new ProviderError("Codex CLI exited with status 17.", {
    details: { stage: "case_audit", stderr: "PRIVATE_RAW_OUTPUT" }
  });
  const provider = {
    ...codex,
    async generate() {
      throw cause;
    }
  };

  await assert.rejects(
    runCaseAudit({ context: { userMessage: "x", recentTranscript: "" }, snapshot: {}, provider }),
    (error) => {
      assert.ok(error instanceof CaseStageError);
      assert.equal(isCaseAuditFailure(error), true);
      assert.deepEqual(
        { stage: error.stage, provider: error.provider, model: error.model },
        { stage: "case_audit", provider: "openai", model: "gpt-5.6-sol" }
      );
      assert.doesNotMatch(JSON.stringify(safeCaseStageFailure(error)), /PRIVATE_RAW_OUTPUT/);
      return true;
    }
  );
});
