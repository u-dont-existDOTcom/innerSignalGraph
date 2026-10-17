import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
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
  assert.equal(result.toolItems, 0, "reasoning and the agent's message are not actions");
});

test("Codex CLI provider passes a caller's extra config settings, each as its own -c", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "inner-signal-codex-args-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const argsFile = path.join(dir, "args.json");
  process.env.FAKE_CODEX_ARGS_FILE = argsFile;
  t.after(() => { delete process.env.FAKE_CODEX_ARGS_FILE; });
  const provider = new CodexCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-codex-cli.mjs")],
    model: "fake-codex",
    timeoutMs: 10000,
    isolateConfig: true,
    configOverrides: ['web_search="disabled"', "features.apps=false"]
  });
  await provider.generate(prompt);
  const args = JSON.parse(await fsp.readFile(argsFile, "utf8"));
  const settings = args.flatMap((arg, index) => (arg === "-c" ? [args[index + 1]] : []));
  assert.ok(settings.includes('web_search="disabled"') && settings.includes("features.apps=false"), settings.join(" "));
  assert.ok(args.includes("--ignore-user-config") && args.includes("--ignore-rules"));
});

test("Codex CLI provider counts the actions its agent took beyond reasoning and its message", async () => {
  const provider = new CodexCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-codex-cli.mjs"), "--fake-tool-item"],
    model: "fake-codex",
    timeoutMs: 10000,
    isolateConfig: false
  });
  const result = await provider.generate(prompt);
  assert.deepEqual(JSON.parse(result.text), { ok: true });
  assert.equal(result.toolItems, 1, "a command started and completed is one action");
});

test("Codex CLI provider gives no action count when its event stream isn't whole", async () => {
  // Codex on #175 (P2): with no completed turn or agent message in the events, zero actions is no receipt.
  const provider = new CodexCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-codex-cli.mjs"), "--fake-no-receipt"],
    model: "fake-codex",
    timeoutMs: 10000,
    isolateConfig: false
  });
  const result = await provider.generate(prompt);
  assert.deepEqual(JSON.parse(result.text), { ok: true }, "the answer itself still arrives");
  assert.equal(result.toolItems, null);
  // Codex on #175 (P2): nor when an event among whole ones is truncated: it could have been an action.
  const broken = new CodexCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-codex-cli.mjs"), "--fake-broken-event"],
    model: "fake-codex",
    timeoutMs: 10000,
    isolateConfig: false
  });
  assert.equal((await broken.generate(prompt)).toolItems, null);
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

test("sealed Claude CLI inference enforces isolation even when ordinary config isolation is disabled", async () => {
  const provider = new ClaudeCliProvider({
    command: process.execPath,
    baseArgs: [path.join(here, "fixtures/fake-claude-cli.mjs"), "--fake-require-sealed"],
    model: "fake-fable",
    timeoutMs: 10000,
    isolateConfig: false
  });
  const result = await provider.generate({ ...prompt, sealed: true });
  assert.deepEqual(JSON.parse(result.text), { ok: true });
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
