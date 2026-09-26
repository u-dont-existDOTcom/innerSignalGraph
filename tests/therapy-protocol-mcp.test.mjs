import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol, unservedReferenceMentions } from "../src/protocol/therapy-protocol.mjs";

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
  assert.ok(skill.endsWith(protocol.instructions), "instructions are the skill body byte for byte");
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
  const loaded = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: {} });
  assert.equal(loaded.body.result.structuredContent.protocol_sha256, after.protocolSha256);
  const map = loaded.body.result.structuredContent.files.find((file) => file.path === "references/INNER-CHILD-THERAPY-MAP.md");
  assert.match(map.content, /Synthetic map fix\./u);
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
  assert.equal(JSON.stringify(manifest.body).includes("<<<BEGIN"), false);

  const loaded = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: {} });
  assert.equal(loaded.response.status, 200);
  const value = loaded.body.result.structuredContent;
  assert.equal(value.version, protocol.version);
  assert.equal(value.instructions, protocol.instructions);
  assert.deepEqual(value.files.map((file) => file.path), [...THERAPY_PROTOCOL_FILES]);
  // The model-facing text carries every block's exact packaged bytes, matching the advertised hashes.
  const text = loaded.body.result.content[0].text;
  const blocks = [["instructions", protocol.instructionsSha256, protocol.instructions], ...protocol.files.map((file) => [file.path, file.sha256, file.content])];
  for (const [label, digest, content] of blocks) {
    const begin = `<<<BEGIN ${label} sha256=${digest} bytes=${Buffer.byteLength(content, "utf8")}>>>\n`;
    const start = text.indexOf(begin);
    assert.notEqual(start, -1, `${label} block is present`);
    const bodyStart = start + begin.length;
    const end = text.indexOf(`<<<END ${label}>>>`, bodyStart);
    const body = text.slice(bodyStart, end);
    assert.equal(content.endsWith("\n") ? body : body.slice(0, -1), content, `${label} bytes are exact`);
    assert.equal(createHash("sha256").update(content, "utf8").digest("hex"), digest);
  }

  // A request for a subset still returns the complete protocol: every reference is mandatory.
  const subset = await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: { paths: [] } });
  assert.deepEqual(subset.body.result.structuredContent.files.map((file) => file.path), [...THERAPY_PROTOCOL_FILES]);

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

test("an unreadable or empty plugin build reports the protocol unavailable", async (t) => {
  const missing = await copyPlugin(t);
  await fs.rm(path.join(missing, "skills/inner-signal-therapy/references/PROTECTIVE-COMPATIBILITY.md"));
  assert.throws(() => loadTherapyProtocol({ pluginRoot: missing }), { code: "THERAPY_PROTOCOL_UNAVAILABLE" });

  const emptyReference = await copyPlugin(t);
  await fs.writeFile(path.join(emptyReference, "skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md"), "\n");
  assert.throws(() => loadTherapyProtocol({ pluginRoot: emptyReference }), { code: "THERAPY_PROTOCOL_UNAVAILABLE" });

  const frontmatterOnly = await copyPlugin(t);
  await fs.writeFile(path.join(frontmatterOnly, "skills/inner-signal-therapy/SKILL.md"), "---\nname: inner-signal-therapy\ndescription: x\n---\n\n");
  assert.throws(() => loadTherapyProtocol({ pluginRoot: frontmatterOnly }), { code: "THERAPY_PROTOCOL_UNAVAILABLE" });
});

test("text that names a reference the server does not serve makes the protocol unavailable", async (t) => {
  const inInstructions = await copyPlugin(t);
  const skillDir = path.join(inInstructions, "skills/inner-signal-therapy");
  await fs.writeFile(path.join(skillDir, "references/SYNTHETIC-UNSERVED.md"), "Synthetic reference.\n");
  await fs.appendFile(path.join(skillDir, "SKILL.md"), "\nAlso read `references/SYNTHETIC-UNSERVED.md` before responding.\n");
  assert.throws(() => loadTherapyProtocol({ pluginRoot: inInstructions }), { code: "THERAPY_PROTOCOL_UNAVAILABLE", message: /skill instructions names references\/SYNTHETIC-UNSERVED\.md/u });

  const inReference = await copyPlugin(t);
  await fs.appendFile(path.join(inReference, "skills/inner-signal-therapy/references/GUIDE-REFERRALS.md"), "\nSee references/SYNTHETIC-UNSERVED.md.\n");
  assert.throws(() => loadTherapyProtocol({ pluginRoot: inReference }), { code: "THERAPY_PROTOCOL_UNAVAILABLE", message: /references\/GUIDE-REFERRALS\.md names references\/SYNTHETIC-UNSERVED\.md/u });

  const nested = await copyPlugin(t);
  await fs.appendFile(path.join(nested, "skills/inner-signal-therapy/SKILL.md"), "\nFor safety also read `references/safety/EXTRA.md`.\n");
  assert.throws(() => loadTherapyProtocol({ pluginRoot: nested }), { code: "THERAPY_PROTOCOL_UNAVAILABLE", message: /names references\/safety\/EXTRA\.md/u });

  // In a code span, any other spelling, character, case or longer name counts as unserved.
  const variants = [
    "references/SOMATIC+SAFETY.md",
    "references/SAFETY GUIDE.md",
    "references/SAFETY.MD",
    "references/guide-referrals.md",
    "references/GUIDE-REFERRALS.md.bak",
    "references/GUIDE-REFERRALS.md..bak",
    "references/GUIDE-REFERRALS.md;x"
  ];
  for (const mention of variants) {
    const variant = await copyPlugin(t);
    await fs.appendFile(path.join(variant, "skills/inner-signal-therapy/SKILL.md"), `\nAlso read \`${mention}\` first.\n`);
    assert.throws(() => loadTherapyProtocol({ pluginRoot: variant }), { code: "THERAPY_PROTOCOL_UNAVAILABLE", message: new RegExp(`names ${mention.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\``, "u") }, mention);
  }

  // Outside a code span, or in an unclosed one, even a served path is reported.
  // So is one in a span delimited by a run of backticks, whose content can run past the first one.
  for (const line of [
    "See references/GUIDE-REFERRALS.md.",
    "Then [the map](references/INNER-CHILD-THERAPY-MAP.md).",
    "Open `references/GUIDE-REFERRALS.md and continue.",
    "Read ``references/GUIDE-REFERRALS.md`.bak`` first.",
    "Read ``references/GUIDE-REFERRALS.md`` first.",
    "Read `references/GUIDE-REFERRALS.md`` first.",
    "Read ``x `references/GUIDE-REFERRALS.md`-UNSERVED`` first.",
    "Read \\`references/GUIDE-REFERRALS.md`.bak\\` first.",
    "Read ` references/GUIDE-REFERRALS.md ` first."
  ]) {
    assert.equal(unservedReferenceMentions(line).length, 1, line);
  }

  // Code spans holding a served path may sit next to any punctuation.
  // An even run of backslashes escapes itself, so the backtick after it still opens a span.
  assert.deepEqual(unservedReferenceMentions("A literal backslash \\\\`references/GUIDE-REFERRALS.md` first."), []);

  const punctuated = await copyPlugin(t);
  await fs.appendFile(path.join(punctuated, "skills/inner-signal-therapy/SKILL.md"), "\nSee `references/GUIDE-REFERRALS.md`. Then (`references/INNER-CHILD-THERAPY-MAP.md`), and `references/FOCUS-DISCIPLINE.md`; done.\n");
  assert.equal(loadTherapyProtocol({ pluginRoot: punctuated }).files.length, THERAPY_PROTOCOL_FILES.length);

  // The packaged skill itself names only served references, and names every served one.
  const protocol = loadTherapyProtocol();
  for (const text of [protocol.instructions, ...protocol.files.map((file) => file.content)]) assert.deepEqual(unservedReferenceMentions(text), []);
  for (const file of THERAPY_PROTOCOL_FILES) assert.ok(protocol.instructions.includes(file), `${file} is named by the instructions`);
});

test("the hosted MCP image ships the packaged skill it serves", async () => {
  const dockerfile = await fs.readFile(path.join(root, "Dockerfile.private-case-mcp"), "utf8");
  assert.match(dockerfile, /^COPY plugins\/inner-signal-therapy \.\/plugins\/inner-signal-therapy$/mu);
});

test("MCP is also answered at the root so a connector URL can equal a bare-origin resource", async (t) => {
  const listener = await listen(t, { oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] }, productionAuthReady: true });
  const rootUrl = listener.url.replace(/\/mcp$/u, "/");
  const [atRoot, atMcp] = await Promise.all([post(rootUrl, "tools/list"), post(listener.url, "tools/list")]);
  assert.equal(atRoot.response.status, 200);
  assert.deepEqual(atRoot.body.result.tools.map((tool) => tool.name), atMcp.body.result.tools.map((tool) => tool.name));
  const privateCall = await post(rootUrl, "tools/call", { name: "retrieve_case_evidence", arguments: { case_id: "synthetic-case", query: "x" } });
  assert.equal(privateCall.response.status, 401);
  assert.match(privateCall.response.headers.get("www-authenticate"), /resource_metadata="https:\/\/private-mcp\.synthetic\.example\/\.well-known\/oauth-protected-resource"/u);
  const other = await fetch(listener.url.replace(/\/mcp$/u, "/elsewhere"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(other.status, 404);
});

test("a pathful resource gets no root MCP endpoint", async (t) => {
  const listener = await listen(t, { oauth: { resource: `${RESOURCE}/mcp`, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] }, productionAuthReady: true });
  const root = await fetch(listener.url.replace(/\/mcp$/u, "/"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  assert.equal(root.status, 404);
  const atMcp = await post(listener.url, "tools/list");
  assert.equal(atMcp.response.status, 200);
});
