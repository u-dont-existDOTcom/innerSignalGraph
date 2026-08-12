import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/core/config.mjs";
import { resolveCliModels } from "../src/autopilot/model-resolver.mjs";

function providerFactory(id, calls) {
  return (options) => ({
    id,
    model: options.model,
    async generate() {
      calls.push({ id, model: options.model });
      return {
        text: JSON.stringify({ ok: true }),
        requestId: `${id}-request-1`,
        responseId: `${id}-response-1`
      };
    }
  });
}

test("primary CLI resolution probes only the exact Guide Packet role models", async () => {
  const calls = [];
  const config = loadConfig({
    mode: "mock",
    openaiModel: "",
    openaiModelFallbacks: ["gpt-5.6", ""],
    anthropicModel: "",
    anthropicModelFallbacks: ["claude-sonnet-4-6", ""]
  });
  const resolution = await resolveCliModels(config, {
    providerFactories: {
      openai: providerFactory("openai", calls),
      anthropic: providerFactory("anthropic", calls)
    }
  });

  assert.equal(resolution.ok, true);
  assert.deepEqual(calls, [
    { id: "openai", model: "gpt-5.6-sol" },
    { id: "anthropic", model: "claude-opus-5" }
  ]);
  assert.deepEqual(resolution.attempts.openai.map((attempt) => attempt.model), ["gpt-5.6-sol"]);
  assert.deepEqual(resolution.attempts.anthropic.map((attempt) => attempt.model), ["claude-opus-5"]);
  assert.equal(resolution.openai.provider.entitlementEvidence.requestedModel, "gpt-5.6-sol");
  assert.equal(resolution.openai.provider.entitlementEvidence.responseId, "openai-response-1");
  assert.equal(resolution.anthropic.provider.entitlementEvidence.requestedModel, "claude-opus-5");
});
