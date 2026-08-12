import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  GUIDE_PACKET_FAILURE,
  classifyGuidePacketFailure
} from "../src/guide-packet/failure-classification.mjs";
import {
  readGuidePacketStageAttempts,
  reconcileGuidePacketProcessingState,
  runGuidePacketStage
} from "../src/guide-packet/stage-lifecycle.mjs";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function tempConfig(prefix = "guide-packet-lifecycle-") {
  const guidePacketRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    guidePacketRoot,
    autopilotStateDir: path.dirname(guidePacketRoot),
    guidePacketHeartbeatMs: 5,
    guidePacketStaleMs: 20
  };
}

async function readStatus(config) {
  return JSON.parse(await fs.readFile(path.join(config.guidePacketRoot, "processing-status.json"), "utf8"));
}

test("stage failure leaves a terminal normalized error instead of stale WORKING", async () => {
  const config = await tempConfig();
  await assert.rejects(
    () => runGuidePacketStage({
      config,
      packetId: "inner-signal-guides-2026.08.11-r01-candidate",
      stageId: "opus-source-role-compilation",
      model: "claude-opus-5",
      expectedNextStage: "codex-independent-audit",
      operation: async () => { throw new Error("Opus compilation unavailable"); },
      persistResult: async () => { throw new Error("must not persist a missing result"); }
    }),
    /Opus compilation unavailable/
  );

  const status = await readStatus(config);
  assert.equal(status.active, false);
  assert.equal(status.lifecycle, "blocked");
  assert.equal(status.overall, "BLOCKED_AUTO_RECOVERY");
  assert.equal(status.failureClass, GUIDE_PACKET_FAILURE.MODEL_UNAVAILABLE);
  assert.equal(status.normalizedError.message, "Opus compilation unavailable");
  assert.equal(status.packetId, "inner-signal-guides-2026.08.11-r01-candidate");
  assert.equal(status.stageId, "opus-source-role-compilation");
  assert.equal(status.model, "claude-opus-5");
  assert.equal(status.expectedNextStage, "codex-independent-audit");
  assert.ok(status.attemptId);
  assert.ok(status.startedAt);
  assert.ok(status.heartbeatAt);

  const ledger = await readGuidePacketStageAttempts(config);
  assert.equal(ledger.attempts.length, 1);
  assert.equal(ledger.attempts[0].attemptId, status.attemptId);
  assert.equal(ledger.attempts[0].lifecycle, "blocked");
  assert.equal(ledger.attempts[0].failureClass, GUIDE_PACKET_FAILURE.MODEL_UNAVAILABLE);
});

test("model timeout preserves staged candidate bytes and creates no installed packet", async () => {
  const config = await tempConfig("guide-packet-timeout-");
  const candidateDir = path.join(config.guidePacketRoot, "candidates", "inner-signal-guides-2026.08.11-r01-candidate");
  const candidateFile = path.join(candidateDir, "original.zip");
  const candidateBytes = Buffer.from("staged-candidate-byte-identity");
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.writeFile(candidateFile, candidateBytes);
  const before = hash(await fs.readFile(candidateFile));

  await assert.rejects(() => runGuidePacketStage({
    config,
    packetId: "inner-signal-guides-2026.08.11-r01-candidate",
    stageId: "opus-source-role-compilation",
    model: "claude-opus-5",
    expectedNextStage: "codex-independent-audit",
    operation: async () => {
      const error = new Error("Claude CLI guide packet compilation timed out after 900000 ms.");
      error.code = "PROVIDER_ERROR";
      throw error;
    }
  }), /timed out/i);

  const after = hash(await fs.readFile(candidateFile));
  assert.equal(after, before);
  const status = await readStatus(config);
  assert.equal(status.failureClass, GUIDE_PACKET_FAILURE.MODEL_TIMEOUT);
  await assert.rejects(() => fs.access(path.join(config.guidePacketRoot, "installed", "current")), { code: "ENOENT" });
});

test("startup reconciliation converts legacy orphaned RUNNING compilation into resumable STALE_STAGE", async () => {
  const config = await tempConfig("guide-packet-orphan-");
  await fs.writeFile(path.join(config.guidePacketRoot, "processing-status.json"), JSON.stringify({
    active: true,
    overall: "WORKING",
    stage: "opus-source-role-compilation",
    packetId: "inner-signal-guides-2026.08.11-r01-candidate",
    model: "claude-opus-5",
    nextAutomaticAction: "AUTO_CONTINUE",
    humanActionRequired: false,
    updatedAt: "2026-08-11T22:20:47.591Z"
  }));

  const result = await reconcileGuidePacketProcessingState(config, {
    now: "2026-08-11T23:05:06.369Z",
    isProcessAlive: () => false
  });
  assert.equal(result.recovered, true);
  assert.equal(result.reason, "orphaned-running-stage");
  const status = await readStatus(config);
  assert.equal(status.active, false);
  assert.equal(status.lifecycle, "recovering");
  assert.equal(status.overall, "RECOVERING");
  assert.equal(status.failureClass, GUIDE_PACKET_FAILURE.STALE_STAGE);
  assert.equal(status.recoveryAction, "resume-from-staged-candidate");
  assert.equal(status.nextAutomaticAction, "AUTO_CONTINUE");
  assert.equal(status.humanActionRequired, false);
  assert.match(status.blocker, /stopped without a terminal state/i);
});

test("failure classifier keeps packet infrastructure and owner policy classes distinct", () => {
  const cases = [
    [new Error("request timed out"), {}, "MODEL_TIMEOUT"],
    [new Error("OAuth refresh token expired; login required"), {}, "AUTH_REQUIRED"],
    [new Error("required exact model gpt-5.6-sol is unavailable"), {}, "MODEL_UNAVAILABLE"],
    [new Error("model returned malformed JSON envelope"), {}, "MALFORMED_MODEL_RESULT"],
    [new Error("graph regression failed"), { phase: "deterministic-verification" }, "DETERMINISTIC_VERIFICATION_FAILURE"],
    [new Error("candidate checksum mismatch"), { phase: "packet-integrity" }, "PACKET_INTEGRITY_FAILURE"],
    [new Error("independent audit rejected candidate"), { phase: "review-rejection" }, "REVIEW_REJECTION"],
    [new Error("running attempt has no live owner"), { phase: "stale-stage" }, "STALE_STAGE"],
    [new Error("substantive guide decision remains"), { phase: "owner-decision" }, "OWNER_DECISION_REQUIRED"]
  ];
  for (const [error, context, expected] of cases) {
    assert.equal(classifyGuidePacketFailure(error, context), expected, error.message);
  }
});
