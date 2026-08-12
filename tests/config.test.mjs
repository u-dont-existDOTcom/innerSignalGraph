import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";

function withEnv(values, fn) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("CLI mode requires no API keys or retention acknowledgment", () => {
  withEnv({
    OPENAI_API_KEY: null,
    ANTHROPIC_API_KEY: null,
    ACKNOWLEDGE_PROVIDER_RETENTION: "false"
  }, () => {
    const config = loadConfig({ mode: "cli" });
    assert.equal(config.mode, "cli");
    assert.equal(config.openaiApiKey, "");
    assert.equal(config.anthropicApiKey, "");
  });
});

test("API mode refuses to run without retention acknowledgment", () => {
  withEnv({
    OPENAI_API_KEY: "test-openai",
    ANTHROPIC_API_KEY: "test-anthropic",
    ACKNOWLEDGE_PROVIDER_RETENTION: "false"
  }, () => {
    assert.throws(
      () => loadConfig({ mode: "api" }),
      (error) => error.code === "RETENTION_ACK_REQUIRED"
    );
  });
});

test("CLI mode blocks Fable unless usage-credit risk is acknowledged", () => {
  withEnv({
    ANTHROPIC_MODEL: "fable",
    ALLOW_CLAUDE_FABLE_USAGE: "false"
  }, () => {
    assert.throws(
      () => loadConfig({ mode: "cli" }),
      (error) => error.code === "FABLE_USAGE_ACK_REQUIRED"
    );
  });
});

test("standalone CLI defaults to Opus with Fable escalation and Codex review", () => {
  const config = loadConfig({ mode: "mock" });
  assert.equal(config.anthropicModel, "claude-opus-5");
  assert.equal(config.anthropicEscalationModel, "claude-fable-5");
  assert.equal(config.responseRendererModel, "claude-sonnet-4-6");
  assert.equal(config.hypnosisWriterProvider, "anthropic");
  assert.equal(config.hypnosisReviewerProvider, "openai");
  assert.equal(config.hypnosisRepairProvider, "anthropic");
  assert.equal(config.hypnosisFinalReviewerProvider, "openai");
});

test("development review recovery has separate normal and extended timeouts", () => {
  withEnv({ DEV_REVIEW_TIMEOUT_MS: null, DEV_REVIEW_EXTENDED_TIMEOUT_MS: null, DEV_LIVE_REGRESSION_ATTEMPTS: null }, () => {
    const config = loadConfig({ mode: "mock" });
    assert.equal(config.devReviewTimeoutMs, 180000);
    assert.equal(config.devReviewExtendedTimeoutMs, 600000);
    assert.equal(config.devLiveRegressionAttempts, 2);
  });
});

test("development live regression has a dedicated timeout independent of ordinary request timeout", () => {
  withEnv({ REQUEST_TIMEOUT_MS: "180000", DEV_LIVE_REGRESSION_TIMEOUT_MS: null }, () => {
    const config = loadConfig({ mode: "mock" });
    assert.equal(config.requestTimeoutMs, 180000);
    assert.equal(config.devLiveRegressionTimeoutMs, 900000);
  });
});

test("Guide Packet stages have a frequent heartbeat and a longer stale threshold", () => {
  withEnv({ GUIDE_PACKET_HEARTBEAT_MS: null, GUIDE_PACKET_STALE_MS: null }, () => {
    const config = loadConfig({ mode: "mock" });
    assert.equal(config.guidePacketHeartbeatMs, 5000);
    assert.equal(config.guidePacketStaleMs, 30000);
    assert.ok(config.guidePacketStaleMs > config.guidePacketHeartbeatMs);
  });
});

test("blank model environment values normalize to exact subscription CLI defaults", () => {
  withEnv({ OPENAI_MODEL: "", ANTHROPIC_MODEL: "", ANTHROPIC_ESCALATION_MODEL: "" }, () => {
    const config = loadConfig({ mode: "cli" });
    assert.equal(config.openaiModel, "gpt-5.6-sol");
    assert.equal(config.anthropicModel, "claude-opus-5");
    assert.equal(config.anthropicEscalationModel, "claude-fable-5");
  });
});

test("an overridden autopilot state root also isolates the default Guide Packet root", () => {
  withEnv({ GUIDE_PACKET_ROOT: null }, () => {
    const autopilotStateDir = path.resolve("/tmp/inner-signal-isolated-state");
    const config = loadConfig({ mode: "mock", autopilotStateDir });
    assert.equal(config.guidePacketRoot, path.join(autopilotStateDir, "guide-packets"));
  });
});
