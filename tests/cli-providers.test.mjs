import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexCliProvider } from "../src/providers/codex-cli.mjs";
import { ClaudeCliProvider } from "../src/providers/claude-cli.mjs";
import { entitlementSchema } from "../src/schemas/json-schemas.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const prompt = {
  system: "Return structured output.",
  user: "Return ok true.",
  outputSchema: entitlementSchema,
  metadata: { stage: "unit-test" }
};

test("Codex CLI provider captures schema output from a subprocess", async () => {
  const provider = new CodexCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-codex-cli.mjs")],
    model: "fake-codex",
    timeoutMs: 10000,
    isolateConfig: false
  });
  const result = await provider.generate(prompt);
  assert.deepEqual(JSON.parse(result.text), { ok: true });
  assert.equal(result.responseId, "fake-codex-thread");
  assert.equal(result.transport, "cli");
});

test("Claude CLI provider extracts structured_output from its JSON envelope", async () => {
  const provider = new ClaudeCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-claude-cli.mjs")],
    model: "fake-fable",
    timeoutMs: 10000,
    isolateConfig: false
  });
  const result = await provider.generate(prompt);
  assert.deepEqual(JSON.parse(result.text), { ok: true });
  assert.equal(result.responseId, "fake-claude-session");
  assert.equal(result.transport, "cli");
});

test("Codex CLI provider omits optional flags unsupported by the installed CLI", async () => {
  const provider = new CodexCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-codex-minimal-cli.mjs")],
    model: "must-be-omitted",
    timeoutMs: 10000,
    isolateConfig: true
  });
  const result = await provider.generate(prompt);
  assert.deepEqual(JSON.parse(result.text), { ok: true });
});

test("Claude CLI provider falls back to inline system prompt and omits unsupported flags", async () => {
  const provider = new ClaudeCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-claude-minimal-cli.mjs")],
    model: "must-be-omitted",
    timeoutMs: 10000,
    isolateConfig: true
  });
  const result = await provider.generate(prompt);
  assert.deepEqual(JSON.parse(result.text), { ok: true });
  assert.equal(result.responseId, "minimal-claude-session");
});
