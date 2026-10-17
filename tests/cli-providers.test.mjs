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

test("Codex CLI provider can send the system text as developer instructions, apart from the user message", async (t) => {
  // Codex on #175 (P2): a caller whose user message carries untrusted text keeps its instructions in a higher role.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "inner-signal-codex-developer-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const promptFile = path.join(dir, "prompt.json");
  process.env.FAKE_CODEX_PROMPT_FILE = promptFile;
  t.after(() => { delete process.env.FAKE_CODEX_PROMPT_FILE; });
  const make = (systemAs) => new CodexCliProvider({ command: process.execPath, baseArgs: [path.join(here, "fixtures/fake-codex-cli.mjs")], model: "fake-codex", timeoutMs: 10000, isolateConfig: false, systemAs });
  await make("developer").generate({ ...prompt, system: 'Grade "strictly".\nLine two.' });
  const sent = JSON.parse(await fsp.readFile(promptFile, "utf8"));
  assert.equal(sent.developer, 'developer_instructions="Grade \\"strictly\\".\\nLine two."', "a TOML string");
  assert.ok(!sent.stdin.includes("SYSTEM INSTRUCTIONS") && !sent.stdin.includes("Grade"));
  await make("prompt").generate(prompt);
  const combined = JSON.parse(await fsp.readFile(promptFile, "utf8"));
  assert.equal(combined.developer, null);
  assert.ok(combined.stdin.startsWith("SYSTEM INSTRUCTIONS\n"), "the default is unchanged");
  assert.throws(() => make("system"), /systemAs must be prompt or developer/u);
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

test("Claude CLI provider caps turns at one by default and can leave the cap out", async (t) => {
  // Codex on #175 (P2): a structured answer takes a turn of its own, so a caller whose agent has no tools can leave the cap
  // out; sealed inference always keeps it.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "inner-signal-claude-args-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const argsFile = path.join(dir, "args.json");
  process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
  t.after(() => { delete process.env.FAKE_CLAUDE_ARGS_FILE; });
  const turnsFor = async (options) => {
    const provider = new ClaudeCliProvider({ command: process.execPath, baseArgs: [path.join(here, "fixtures/fake-claude-cli.mjs")], model: "fake-claude", timeoutMs: 10000, ...options });
    await provider.generate(prompt);
    const args = JSON.parse(await fsp.readFile(argsFile, "utf8"));
    const at = args.indexOf("--max-turns");
    return at < 0 ? null : args[at + 1];
  };
  assert.equal(await turnsFor({}), "1");
  assert.equal(await turnsFor({ maxTurns: null }), null);
  assert.equal(await turnsFor({ maxTurns: 3 }), "3");
  // Sealed inference always caps: the fake refuses a sealed call without --max-turns (its environment carries no args file).
  const sealed = new ClaudeCliProvider({ command: process.execPath, baseArgs: [path.join(here, "fixtures/fake-claude-cli.mjs"), "--fake-require-sealed"], model: "fake-claude", timeoutMs: 10000, maxTurns: null });
  await assert.doesNotReject(sealed.generate({ ...prompt, sealed: true }));
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
