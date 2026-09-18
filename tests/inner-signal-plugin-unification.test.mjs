import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const manifestUrl = new URL("../plugins/inner-signal-therapy/.codex-plugin/plugin.json", import.meta.url);
const therapySkillUrl = new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md", import.meta.url);
const continuitySkillUrl = new URL("../plugins/inner-signal-therapy/skills/inner-signal-private-continuity/SKILL.md", import.meta.url);
const mcpSourceUrl = new URL("../src/server/private-case-mcp.mjs", import.meta.url);
const nativeBridgeSourceUrl = new URL("../src/server/private-case-chatgpt-app.mjs", import.meta.url);

const expectedReadOnlyTools = [
  "load_handoff",
  "load_case_context",
  "get_state_diff",
  "get_recent_verbatim",
  "retrieve_case_evidence",
  "get_pending_candidate",
  "get_tracker_window",
  "get_journal_entries",
  "get_candidate_response",
  "get_source_artifact"
];

test("InnerSignal package presents one user-facing plugin identity", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
  assert.equal(manifest.name, "inner-signal-therapy");
  assert.equal(manifest.interface.displayName, "InnerSignal");
  assert.ok(manifest.interface.capabilities.includes("Advisory"));
  assert.ok(manifest.interface.capabilities.includes("Read"));
  assert.ok(manifest.interface.capabilities.includes("Write"));
  assert.ok(manifest.interface.defaultPrompt.some(prompt => /private InnerSignal handoff/i.test(prompt)));
});

test("therapy skill routes private continuation inside the same plugin", async () => {
  const skill = await fs.readFile(therapySkillUrl, "utf8");
  assert.match(skill, /same \*\*InnerSignal\*\* plugin/i);
  assert.match(skill, /Do not tell the user to install a separate handoff\/continuity plugin/i);
  assert.match(skill, /use that capability first/i);
});

test("private continuity skill uses the existing read-only MCP surface", async () => {
  const [skill, mcp] = await Promise.all([
    fs.readFile(continuitySkillUrl, "utf8"),
    fs.readFile(mcpSourceUrl, "utf8")
  ]);
  assert.match(skill, /read-only/i);
  assert.match(skill, /call `load_handoff` first/i);
  assert.match(skill, /Do not ask the user to paste bearer tokens/i);
  for (const tool of expectedReadOnlyTools) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`));
    assert.match(mcp, new RegExp(`name: "${tool}"`));
  }
});

test("the same plugin documents the bounded native-controlled application bridge", async () => {
  const [manifest, skill, bridge] = await Promise.all([
    fs.readFile(manifestUrl, "utf8").then(JSON.parse),
    fs.readFile(continuitySkillUrl, "utf8"),
    fs.readFile(nativeBridgeSourceUrl, "utf8")
  ]);
  assert.match(manifest.interface.longDescription, /controlled native ChatGPT turn/i);
  assert.match(skill, /open_controlled_case_turn/u);
  assert.match(skill, /same-chat native draft is not an independent review/i);
  for (const tool of [
    "open_controlled_case_turn",
    "prepare_controlled_case_turn",
    "get_controlled_turn_context",
    "submit_native_candidate",
    "get_controlled_turn_status",
    "get_controlled_reply_artifact",
    "acknowledge_controlled_reply"
  ]) assert.match(bridge, new RegExp(`name: "${tool}"`));
});
