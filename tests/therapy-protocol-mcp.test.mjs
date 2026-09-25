import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.join(root, "plugins/inner-signal-therapy");
const skillDir = path.join(pluginRoot, "skills/inner-signal-therapy");
const RESOURCE = "https://private-mcp.synthetic.example";
const ISSUER = "https://identity.synthetic.example";

const deniedService = Object.freeze({
  async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
  async retrieveCaseEvidence() { throw new PrivateCaseAccessDeniedError(); }
});

async function post(url, method, params = {}, token = null) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { response, body: await response.json() };
}

async function listen(t, options = {}) {
  const listener = await listenPrivateCaseMcp({ caseAccessService: deniedService, ...options });
  t.after(() => listener.close());
  return listener;
}

async function copyPlugin(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-protocol-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(pluginRoot, dir, { recursive: true });
  return dir;
}

test("served protocol is the packaged skill, byte for byte, and the map matches the canonical doc", async () => {
  const protocol = loadTherapyProtocol();
  const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(protocol.version, manifest.version);
  assert.deepEqual(protocol.files.map((file) => file.path), [...THERAPY_PROTOCOL_FILES]);
  for (const file of protocol.files) {
    assert.equal(file.content, await fs.readFile(path.join(skillDir, file.path), "utf8"));
  }
  const skill = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  assert.ok(skill.includes(protocol.instructions));
  assert.doesNotMatch(protocol.instructions, /^---/u);
  for (const relative of THERAPY_PROTOCOL_FILES) assert.ok(skill.includes(relative), `${relative} is referenced by the skill`);
  const map = protocol.files.find((file) => file.path === "references/INNER-CHILD-THERAPY-MAP.md");
  assert.equal(map.content, await fs.readFile(path.join(root, "docs/INNER-CHILD-THERAPY-MAP.md"), "utf8"));
});

test("a map fix changes the served hash without a version bump or plugin reinstall", async (t) => {
  const dir = await copyPlugin(t);
  const before = loadTherapyProtocol({ pluginRoot: dir });
  const mapPath = path.join(dir, "skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md");
  await fs.appendFile(mapPath, "\nSynthetic map fix.\n");
  const after = loadTherapyProtocol({ pluginRoot: dir });
  assert.equal(after.version, before.version);
  assert.notEqual(after.protocolSha256, before.protocolSha256);

  const listener = await listen(t, { therapyProtocol: after });
  const loaded = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: { paths: ["references/INNER-CHILD-THERAPY-MAP.md"] } });
  assert.equal(loaded.body.result.structuredContent.protocol_sha256, after.protocolSha256);
  assert.match(loaded.body.result.structuredContent.files[0].content, /Synthetic map fix\./u);
});

test("initialize tells the host to load the protocol first and to fail closed", async (t) => {
  const listener = await listen(t);
  const { body } = await post(listener.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const { instructions } = body.result;
  assert.match(instructions, /call load_therapy_protocol/u);
  assert.match(instructions, /unavailable right now instead of improvising/u);
  assert.match(instructions, /call load_handoff first/u);
  assert.match(instructions, /never put bearer tokens/u);
});

test("protocol tools are public and read-only while private case tools keep OAuth", async (t) => {
  const listener = await listen(t, { oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] }, productionAuthReady: true });
  const listed = await post(listener.url, "tools/list");
  const tools = listed.body.result.tools;
  assert.deepEqual(tools.slice(0, 2).map((tool) => tool.name), ["get_therapy_protocol_manifest", "load_therapy_protocol"]);
  for (const tool of tools.slice(0, 2)) {
    assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }]);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  assert.equal(tools.find((tool) => tool.name === "load_handoff").securitySchemes[0].type, "oauth2");

  const protocol = loadTherapyProtocol();
  const manifest = await post(listener.url, "tools/call", { name: "get_therapy_protocol_manifest", arguments: {} });
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.body.result.structuredContent.protocol_sha256, protocol.protocolSha256);
  assert.equal(JSON.stringify(manifest.body).includes("## Instructions"), false);

  const loaded = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: {} });
  assert.equal(loaded.response.status, 200);
  const value = loaded.body.result.structuredContent;
  assert.equal(value.version, protocol.version);
  assert.equal(value.instructions, protocol.instructions);
  assert.deepEqual(value.files.map((file) => file.path), [...THERAPY_PROTOCOL_FILES]);
  const text = loaded.body.result.content[0].text;
  assert.match(text, /## Instructions/u);
  assert.match(text, /## references\/INNER-CHILD-THERAPY-MAP\.md/u);

  const unknown = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: { paths: ["../../.env"] } });
  assert.equal(unknown.body.error.data.code, "THERAPY_PROTOCOL_FILE_UNKNOWN");
  assert.equal(JSON.stringify(unknown.body).includes("## Instructions"), false);

  const privateCall = await post(listener.url, "tools/call", { name: "retrieve_case_evidence", arguments: { case_id: "synthetic-case", query: "x" } });
  assert.equal(privateCall.response.status, 401);
  assert.match(privateCall.response.headers.get("www-authenticate"), /oauth-protected-resource/u);
});

test("a missing protocol fails closed without affecting private tools", async (t) => {
  const listener = await listen(t, { therapyProtocol: null });
  const health = await fetch(listener.url.replace(/\/mcp$/u, "/health")).then((response) => response.json());
  assert.equal(health.therapyProtocol, null);
  const loaded = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: {} });
  assert.equal(loaded.body.error.data.code, "THERAPY_PROTOCOL_UNAVAILABLE");
  assert.match(loaded.body.error.message, /do not improvise/u);
  assert.equal(Object.hasOwn(loaded.body, "result"), false);
  const privateCall = await post(listener.url, "tools/call", { name: "retrieve_case_evidence", arguments: { case_id: "synthetic-case", query: "x" } });
  assert.equal(privateCall.response.status, 401);
});

test("an unreadable plugin build reports the protocol unavailable", async (t) => {
  const dir = await copyPlugin(t);
  await fs.rm(path.join(dir, "skills/inner-signal-therapy/references/PROTECTIVE-COMPATIBILITY.md"));
  assert.throws(() => loadTherapyProtocol({ pluginRoot: dir }), { code: "THERAPY_PROTOCOL_UNAVAILABLE" });
});

test("the hosted MCP image ships the packaged skill it serves", async () => {
  const dockerfile = await fs.readFile(path.join(root, "Dockerfile.private-case-mcp"), "utf8");
  assert.match(dockerfile, /^COPY plugins\/inner-signal-therapy \.\/plugins\/inner-signal-therapy$/mu);
});
