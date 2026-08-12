import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { ensureBundledGuidePacketCandidate, recoverGuidePacketCandidateOnStartup } from "../src/guide-packet/autopilot.mjs";
import { readGuidePacketStatus, stageGuidePacket, applyGuidePacketCompilation, recordGuidePacketDecision } from "../src/guide-packet/store.mjs";
import { readGuidePacketStageAttempts } from "../src/guide-packet/stage-lifecycle.mjs";

class JsonProvider {
  constructor(id, model, value) {
    this.id = id;
    this.model = model;
    this.value = value;
    this.calls = 0;
    this.entitlementEvidence = {
      ok: true,
      requestedModel: model,
      responseId: `${id}-entitlement`,
      probedAt: new Date().toISOString()
    };
  }
  async generate() {
    this.calls += 1;
    return { text: JSON.stringify(this.value), requestId: `${this.id}-${this.calls}`, responseId: `${this.id}-${this.calls}` };
  }
}

const fixturePath = path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip");

function reviewValue() {
  return {
    verdict: "pass",
    summary: "The compiled candidate is source-supported and still owner-gated.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "A route could activate too broadly."
  };
}

test("bundled substantive candidate auto-stages and receives independent review without installing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-autostage-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "pass",
    summary: "Source-supported candidate that still requires owner decisions.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "A route could activate too broadly."
  });
  const result = await ensureBundledGuidePacketCandidate({ config, fixturePath, reviewer });
  assert.equal(result.staged, true);
  assert.equal(result.reviewed, true);
  assert.equal(reviewer.calls, 1);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.installed, null);
  assert.equal(status.candidate.status, "awaiting-owner");
  assert.equal(status.candidate.independentReview.status, "reviewed");
  assert.equal(status.process.humanActionRequired, true);
});

test("bundled candidate staging is idempotent and does not repeat review on unchanged state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-autostage-idempotent-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "pass",
    summary: "Reviewed.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "None beyond the decision cards."
  });
  await ensureBundledGuidePacketCandidate({ config, fixturePath, reviewer });
  const second = await ensureBundledGuidePacketCandidate({ config, fixturePath, reviewer });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "candidate-already-staged");
  assert.equal(reviewer.calls, 1);
});


test("autopilot resumes an interrupted staged packet through missing compilation and review", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-autostage-resume-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  await stageGuidePacket(config, await fs.readFile(fixturePath));
  const compiler = new JsonProvider("anthropic", "claude-opus-5", {
    verdict: "compiled",
    summary: "Compiled after restart.",
    unresolved_material_disagreement: false,
    source_roles: [],
    graph_changes: [],
    findings: [],
    worst_plausible_failure: "A source nuance could be compiled too broadly."
  });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "pass",
    summary: "Reviewed after resumed compilation.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "A route could activate too broadly."
  });
  const result = await ensureBundledGuidePacketCandidate({ config, fixturePath, compiler, reviewer });
  assert.equal(result.compiled, true);
  assert.equal(result.reviewed, true);
  assert.equal(compiler.calls, 1);
  assert.equal(reviewer.calls, 1);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.candidate.compilation.status, "compiled");
  assert.equal(status.candidate.independentReview.status, "reviewed");
});

test("autopilot resumes independent review without recompiling a persisted Opus report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-autostage-review-resume-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const staged = await stageGuidePacket(config, await fs.readFile(fixturePath));
  await applyGuidePacketCompilation(config, staged.packetId, {
    contractVersion: "guide-packet-opus-compilation-v1",
    status: "compiled",
    compiledAt: "2026-08-11T20:00:00.000Z",
    compiler: { provider: "anthropic", model: "claude-opus-5", requestId: "compile-1" },
    report: { verdict: "compiled", summary: "Already compiled.", unresolved_material_disagreement: false, source_roles: [], graph_changes: [], findings: [], worst_plausible_failure: "none" }
  });
  const compiler = new JsonProvider("anthropic", "claude-opus-5", { throw: true });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "pass",
    summary: "Review resumed.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "A route could activate too broadly."
  });
  const result = await ensureBundledGuidePacketCandidate({ config, fixturePath, compiler, reviewer });
  assert.equal(result.compiled, true);
  assert.equal(result.reviewed, true);
  assert.equal(compiler.calls, 0);
  assert.equal(reviewer.calls, 1);
});

test("Opus exception becomes durable recovery state and the same staged candidate resumes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-autostage-failure-resume-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const compilerFailure = {
    id: "anthropic",
    model: "claude-opus-5",
    entitlementEvidence: { ok: true, requestedModel: "claude-opus-5", responseId: "opus-entitlement", probedAt: new Date().toISOString() },
    calls: 0,
    async generate() {
      this.calls += 1;
      throw new Error("Opus compilation unavailable");
    }
  };
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", reviewValue());

  await assert.rejects(
    () => ensureBundledGuidePacketCandidate({ config, fixturePath, compiler: compilerFailure, reviewer }),
    /Opus compilation unavailable/
  );
  const failed = await readGuidePacketStatus(config);
  const originalFile = path.join(config.guidePacketRoot, "candidates", failed.candidate.packetId, "original.zip");
  const originalBytes = await fs.readFile(originalFile);
  assert.equal(failed.process.active, false);
  assert.equal(failed.process.lifecycle, "blocked");
  assert.equal(failed.process.failureClass, "MODEL_UNAVAILABLE");
  assert.equal(failed.candidate.compilation, undefined);
  assert.equal(failed.candidate.independentReview, undefined);
  assert.equal(failed.installed, null);

  const compiler = new JsonProvider("anthropic", "claude-opus-5", {
    verdict: "compiled",
    summary: "Compilation resumed from the staged candidate.",
    unresolved_material_disagreement: false,
    source_roles: [],
    graph_changes: [],
    findings: [],
    worst_plausible_failure: "A source nuance could be compiled too broadly."
  });
  const resumed = await ensureBundledGuidePacketCandidate({ config, fixturePath, compiler, reviewer });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.reviewed, true);
  assert.equal(compiler.calls, 1);
  assert.equal(reviewer.calls, 1);
  const completed = await readGuidePacketStatus(config);
  assert.deepEqual(await fs.readFile(originalFile), originalBytes);
  assert.equal(completed.candidate.packetId, failed.candidate.packetId);
  assert.equal(completed.candidate.packetSha256, failed.candidate.packetSha256);
  assert.equal(completed.installed, null);
  assert.equal(completed.process.overall, "WAITING_FOR_HUMAN");
});

test("live Guide Packet stages require run-local exact-model entitlement evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-entitlement-evidence-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  let calls = 0;
  const compiler = {
    id: "anthropic",
    model: "claude-opus-5",
    async generate() { calls += 1; return { text: "{}" }; }
  };
  await assert.rejects(
    () => ensureBundledGuidePacketCandidate({ config, fixturePath, compiler }),
    /requires successful live entitlement evidence/i
  );
  assert.equal(calls, 0);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.process.lifecycle, "blocked");
  assert.equal(status.process.failureClass, "MODEL_UNAVAILABLE");
});

test("startup stale-stage recovery preserves owner decisions while resuming missing compilation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-autostage-owner-preserve-"));
  const config = loadConfig({ mode: "mock", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const staged = await stageGuidePacket(config, await fs.readFile(fixturePath));
  const firstCard = staged.decisionCards[0];
  const decided = await recordGuidePacketDecision(config, {
    candidateId: staged.packetId,
    cardId: firstCard.id,
    decision: "keep-current",
    note: "Preserve this owner decision across infrastructure recovery."
  });
  const decidedCard = decided.decisionCards.find((card) => card.id === firstCard.id);
  await fs.writeFile(path.join(config.guidePacketRoot, "processing-status.json"), JSON.stringify({
    active: true,
    overall: "WORKING",
    stage: "opus-source-role-compilation",
    packetId: staged.packetId,
    model: "claude-opus-5",
    updatedAt: "2026-08-11T22:20:47.591Z",
    humanActionRequired: false
  }));

  const compiler = new JsonProvider("anthropic", "claude-opus-5", {
    verdict: "compiled",
    summary: "Recovered compilation.",
    unresolved_material_disagreement: false,
    source_roles: [],
    graph_changes: [],
    findings: [],
    worst_plausible_failure: "A source nuance could be compiled too broadly."
  });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", reviewValue());
  await ensureBundledGuidePacketCandidate({ config, fixturePath, compiler, reviewer });

  const status = await readGuidePacketStatus(config);
  const preserved = status.candidate.decisionCards.find((card) => card.id === firstCard.id);
  assert.equal(preserved.status, "keep-current");
  assert.equal(preserved.ownerNote, decidedCard.ownerNote);
  assert.equal(preserved.decidedAt, decidedCard.decidedAt);
  assert.equal(status.installed, null);
  const attempts = await readGuidePacketStageAttempts(config);
  assert.ok(attempts.attempts.some((attempt) => attempt.failureClass === "STALE_STAGE"));
  assert.ok(attempts.attempts.some((attempt) => attempt.stageId === "opus-source-role-compilation" && attempt.lifecycle === "completed"));
});

test("startup recovery resumes an orphaned candidate through the shared processor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-startup-recovery-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const staged = await stageGuidePacket(config, await fs.readFile(fixturePath));
  await fs.writeFile(path.join(config.guidePacketRoot, "processing-status.json"), JSON.stringify({
    active: true,
    overall: "WORKING",
    stage: "opus-source-role-compilation",
    packetId: staged.packetId,
    model: "claude-opus-5",
    updatedAt: "2026-08-11T22:20:47.591Z"
  }));
  const compiler = new JsonProvider("anthropic", "claude-opus-5", {
    verdict: "compiled",
    summary: "Recovered on server startup.",
    unresolved_material_disagreement: false,
    source_roles: [],
    graph_changes: [],
    findings: [],
    worst_plausible_failure: "A source nuance could be compiled too broadly."
  });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", reviewValue());
  const recovery = await recoverGuidePacketCandidateOnStartup({
    config,
    providers: { anthropic: compiler, openai: reviewer }
  });
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.result.reviewed, true);
  assert.equal(compiler.calls, 1);
  assert.equal(reviewer.calls, 1);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.process.overall, "WAITING_FOR_HUMAN");
  assert.equal(status.installed, null);
});

test("Fable failure preserves the completed Codex audit and resumes only adjudication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-fable-resume-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const compiler = new JsonProvider("anthropic", "claude-opus-5", {
    verdict: "compiled",
    summary: "Compiled for disagreement audit.",
    unresolved_material_disagreement: false,
    source_roles: [],
    graph_changes: [],
    findings: [],
    worst_plausible_failure: "A source nuance could be compiled too broadly."
  });
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "review",
    summary: "One material source-role disagreement remains.",
    unresolved_material_disagreement: true,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "Unsupported inference could become policy."
  });
  const failingFable = {
    id: "anthropic",
    model: "claude-fable-5",
    entitlementEvidence: { ok: true, requestedModel: "claude-fable-5", responseId: "fable-entitlement", probedAt: new Date().toISOString() },
    calls: 0,
    async generate() { this.calls += 1; throw new Error("Fable adjudication unavailable"); }
  };

  await assert.rejects(
    () => ensureBundledGuidePacketCandidate({ config, fixturePath, compiler, reviewer, escalationReviewer: failingFable }),
    /Fable adjudication unavailable/
  );
  const interrupted = await readGuidePacketStatus(config);
  assert.equal(interrupted.candidate.reviewProgress.codex.audit.verdict, "review");
  assert.equal(interrupted.candidate.independentReview, undefined);
  assert.equal(reviewer.calls, 1);
  assert.equal(failingFable.calls, 1);
  const interruptedAttempts = await readGuidePacketStageAttempts(config);
  assert.ok(interruptedAttempts.attempts.some((attempt) => attempt.stageId === "codex-independent-audit" && attempt.lifecycle === "completed"));
  assert.ok(interruptedAttempts.attempts.some((attempt) => attempt.stageId === "fable-adjudication" && attempt.lifecycle === "blocked"));

  const fable = new JsonProvider("anthropic", "claude-fable-5", {
    verdict: "pass",
    summary: "The disagreement is bounded by an owner decision.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "An owner decision could be misread."
  });
  const resumed = await ensureBundledGuidePacketCandidate({ config, fixturePath, compiler, reviewer, escalationReviewer: fable });
  assert.equal(resumed.review.status, "reviewed");
  assert.equal(compiler.calls, 1);
  assert.equal(reviewer.calls, 1);
  assert.equal(fable.calls, 1);
});
