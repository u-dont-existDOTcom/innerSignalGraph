import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderError } from "../src/core/errors.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { runAuditedCaseFormulation } from "../src/case-formulation/run.mjs";
import {
  buildA001StageFingerprint,
  createA001StageRecovery
} from "../src/autopilot/a001-stage-recovery.mjs";

function snapshot() {
  return {
    user_goal: "Understand the conflict",
    current_issue: "CLINICAL_SNAPSHOT_SENTINEL",
    direct_observations: [
      { id: "o1", statement: "Love feels unsafe", evidence: "The user said so" }
    ],
    variables: blankCaseVariables(),
    hypotheses: [],
    unknowns: []
  };
}

function acceptedAudit() {
  return {
    remove_observation_ids: [],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "accept",
    summary: "The extraction preserves the stated uncertainty."
  };
}

function context() {
  return {
    userMessage: "test",
    recentTranscript: "",
    userFacts: [],
    guideManifest: { version: "inner-child-somatic-pilot-2026-08-09-r5" },
    guideExcerpts: "No excerpts are needed by the fake provider."
  };
}

function extractionProvider(counter, model = "claude-fable-5") {
  return {
    id: "anthropic",
    model,
    async generate() {
      counter.calls += 1;
      return {
        text: JSON.stringify(snapshot()),
        requestId: `extract-${counter.calls}`,
        stderr: "RAW_EXTRACTOR_STDERR_SENTINEL",
        prompt: "RAW_EXTRACTOR_PROMPT_SENTINEL"
      };
    }
  };
}

function failingAuditor(counter) {
  return {
    id: "openai",
    model: "gpt-5.6-sol",
    async generate() {
      counter.calls += 1;
      throw new ProviderError("Codex CLI case_audit timed out after 900000 ms.", {
        details: {
          stderr: "RAW_AUDITOR_STDERR_SENTINEL",
          stdout: "RAW_AUDITOR_STDOUT_SENTINEL",
          transcript: "RAW_TRANSCRIPT_SENTINEL"
        }
      });
    }
  };
}

function successfulAuditor(counter) {
  return {
    id: "openai",
    model: "gpt-5.6-sol",
    async generate() {
      counter.calls += 1;
      return { text: JSON.stringify(acceptedAudit()), requestId: `audit-${counter.calls}` };
    }
  };
}

function fingerprint(extra = {}) {
  return buildA001StageFingerprint({
    caseId: "A001-inner-child-credibility",
    pipelineRevision: "test-revision",
    guideVersion: "inner-child-somatic-pilot-2026-08-09-r5",
    lane: "fable",
    extractor: "claude-fable-5",
    auditor: "gpt-5.6-sol",
    ...extra
  });
}

test("A001 restart resumes only the failed Codex audit from one completed extraction", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-a001-recovery-"));
  const extractionCount = { calls: 0 };
  const failedAuditCount = { calls: 0 };
  const recovery = createA001StageRecovery({
    stateDir,
    lane: "fable",
    fingerprint: fingerprint(),
    maxAuditAttempts: 2
  });

  await assert.rejects(
    runAuditedCaseFormulation({
      context: context(),
      extractorProvider: extractionProvider(extractionCount),
      auditorProvider: failingAuditor(failedAuditCount),
      recovery
    })
  );
  assert.equal(extractionCount.calls, 1);
  assert.equal(failedAuditCount.calls, 2);

  const checkpointText = await fs.readFile(path.join(stateDir, "a001-stage", "fable.json"), "utf8");
  assert.match(checkpointText, /CLINICAL_SNAPSHOT_SENTINEL/);
  assert.doesNotMatch(checkpointText, /RAW_EXTRACTOR_STDERR_SENTINEL|RAW_EXTRACTOR_PROMPT_SENTINEL/);
  assert.doesNotMatch(checkpointText, /"text"\s*:/);

  const attemptText = await fs.readFile(path.join(stateDir, "a001-stage-attempts.json"), "utf8");
  const attemptLedger = JSON.parse(attemptText);
  assert.equal(attemptLedger.attempts.length, 2);
  assert.deepEqual(attemptLedger.attempts.map((item) => item.failure.classification), ["TRANSIENT", "TRANSIENT"]);
  assert.doesNotMatch(attemptText, /CLINICAL_SNAPSHOT_SENTINEL|RAW_AUDITOR_STDERR_SENTINEL|RAW_AUDITOR_STDOUT_SENTINEL|RAW_TRANSCRIPT_SENTINEL/);

  const successfulAuditCount = { calls: 0 };
  const resumed = await runAuditedCaseFormulation({
    context: context(),
    extractorProvider: extractionProvider(extractionCount),
    auditorProvider: successfulAuditor(successfulAuditCount),
    recovery: createA001StageRecovery({
      stateDir,
      lane: "fable",
      fingerprint: fingerprint(),
      maxAuditAttempts: 2
    })
  });
  assert.equal(extractionCount.calls, 1);
  assert.equal(successfulAuditCount.calls, 1);
  assert.equal(resumed.providerMetadata.extractor.resumed, true);
  assert.equal(resumed.providerMetadata.auditor.model, "gpt-5.6-sol");
});

test("A001 extraction checkpoint requires matching fingerprint and exact extractor model", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-a001-mismatch-"));
  const firstExtraction = { calls: 0 };
  await runAuditedCaseFormulation({
    context: context(),
    extractorProvider: extractionProvider(firstExtraction),
    auditorProvider: successfulAuditor({ calls: 0 }),
    recovery: createA001StageRecovery({ stateDir, lane: "fable", fingerprint: fingerprint(), maxAuditAttempts: 2 })
  });
  assert.equal(firstExtraction.calls, 1);

  const changedFingerprintExtraction = { calls: 0 };
  await runAuditedCaseFormulation({
    context: context(),
    extractorProvider: extractionProvider(changedFingerprintExtraction),
    auditorProvider: successfulAuditor({ calls: 0 }),
    recovery: createA001StageRecovery({
      stateDir,
      lane: "fable",
      fingerprint: fingerprint({ guideVersion: "changed-guide" }),
      maxAuditAttempts: 2
    })
  });
  assert.equal(changedFingerprintExtraction.calls, 1);

  const changedModelExtraction = { calls: 0 };
  await runAuditedCaseFormulation({
    context: context(),
    extractorProvider: extractionProvider(changedModelExtraction, "claude-opus-5"),
    auditorProvider: successfulAuditor({ calls: 0 }),
    recovery: createA001StageRecovery({ stateDir, lane: "fable", fingerprint: fingerprint(), maxAuditAttempts: 2 })
  });
  assert.equal(changedModelExtraction.calls, 1);
});

test("non-retryable A001 audit failure makes exactly one Codex attempt", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-a001-deterministic-"));
  const extractionCount = { calls: 0 };
  const auditCount = { calls: 0 };
  const auditor = {
    id: "openai",
    model: "gpt-5.6-sol",
    async generate() {
      auditCount.calls += 1;
      throw new ProviderError("Installed Codex CLI lacks required structured-output flags.", { code: "CLI_INCOMPATIBLE" });
    }
  };
  await assert.rejects(runAuditedCaseFormulation({
    context: context(),
    extractorProvider: extractionProvider(extractionCount),
    auditorProvider: auditor,
    recovery: createA001StageRecovery({ stateDir, lane: "fable", fingerprint: fingerprint(), maxAuditAttempts: 2 })
  }));
  assert.equal(extractionCount.calls, 1);
  assert.equal(auditCount.calls, 1);
});
