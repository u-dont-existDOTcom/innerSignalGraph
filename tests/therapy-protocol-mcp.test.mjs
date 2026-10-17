import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateCaseMcpServer, listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol, unservedReferenceMentions } from "../src/protocol/therapy-protocol.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.join(root, "plugins/inner-signal-therapy");
const skillDir = path.join(pluginRoot, "skills/inner-signal-therapy");
const RESOURCE = "https://private-mcp.synthetic.example";
const ISSUER = "https://identity.synthetic.example";

const deniedService = Object.freeze({
  async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
  async loadCaseContextByAlias() { throw new PrivateCaseAccessDeniedError(); },
  async retrieveCaseEvidence() { throw new PrivateCaseAccessDeniedError(); }
});

// A synthetic case that opens for anyone: the access checks are tested elsewhere; here only what the connector adds.
const SYNTHETIC_CASE_ID = "synthetic-case-opened";
const openedCase = Object.freeze({ case_state: { case_id: SYNTHETIC_CASE_ID }, recent_verbatim: [{ text: "synthetic turn" }] });
const openingService = Object.freeze({
  async loadHandoff(handoffId) { return { handoff_id: handoffId, case_id: SYNTHETIC_CASE_ID }; },
  async loadCaseContext() { return openedCase; },
  async loadCaseContextByAlias() { return openedCase; },
  async retrieveCaseEvidence(caseId) {
    if (caseId === "synthetic-case-failing") throw Object.assign(new Error("synthetic failure"), { code: "free text that is not a code" });
    return { case_id: caseId, results: [] };
  }
});
const CASE_RULE_FILES = ["references/PROTOCOL-STATE-PROVENANCE.md", "references/LONGITUDINAL-SYNTHESIS.md"];

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
  assert.match(instructions, /load_case_context_by_alias before searching or reconstructing prior conversation/u);
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

test("opening a case carries the reparenting and known-versus-new rules, byte for byte, with the protocol's identity", async (t) => {
  const protocol = loadTherapyProtocol();
  const listener = await listen(t, { caseAccessService: openingService, therapyProtocol: protocol });
  for (const [name, args] of [
    ["load_handoff", { handoff_id: "handoff:00000000-0000-4000-8000-000000000172" }],
    ["load_case_context", { case_id: SYNTHETIC_CASE_ID }],
    ["load_case_context_by_alias", { case_alias: "synthetic alias" }]
  ]) {
    const { response, body } = await post(listener.url, "tools/call", { name, arguments: args });
    assert.equal(response.status, 200, name);
    const value = body.result.structuredContent;
    assert.equal(value.case_state?.case_id ?? value.case_id, SYNTHETIC_CASE_ID, `${name} still returns the case`);
    const rules = value.therapy_rules;
    assert.equal(rules.available, true, name);
    assert.equal(rules.protocol_id, protocol.protocolId);
    assert.equal(rules.version, protocol.version);
    assert.equal(rules.protocol_sha256, protocol.protocolSha256);
    assert.match(rules.note, /call load_therapy_protocol for the complete rules and follow them/u);
    assert.deepEqual(rules.files.map((file) => file.path), CASE_RULE_FILES);
    for (const file of rules.files) {
      const servedFile = protocol.files.find((entry) => entry.path === file.path);
      assert.deepEqual(file, { path: servedFile.path, sha256: servedFile.sha256, bytes: servedFile.bytes, content: servedFile.content });
    }
    assert.match(rules.files[0].content, /A protective act the person takes for the vulnerable self in daily life/u);
    assert.match(rules.files[1].content, /KNOWN VERSUS NEW/u);
    assert.deepEqual(JSON.parse(body.result.content[0].text), value, `${name}: the text the model reads carries them too`);
  }
  // Other case tools are unchanged.
  const evidence = await post(listener.url, "tools/call", { name: "retrieve_case_evidence", arguments: { case_id: SYNTHETIC_CASE_ID, query: "x" } });
  assert.equal(evidence.response.status, 200);
  assert.deepEqual(evidence.body.result.structuredContent, { case_id: SYNTHETIC_CASE_ID, results: [] });
  const listed = await post(listener.url, "tools/list");
  for (const name of ["load_handoff", "load_case_context", "load_case_context_by_alias"]) {
    assert.match(listed.body.result.tools.find((tool) => tool.name === name).description, /The result also carries therapy_rules/u, name);
  }
});

test("without a protocol, an opened case says the rules are unavailable and still loads", async (t) => {
  const listener = await listen(t, { caseAccessService: openingService, therapyProtocol: null });
  const { response, body } = await post(listener.url, "tools/call", { name: "load_case_context", arguments: { case_id: SYNTHETIC_CASE_ID } });
  assert.equal(response.status, 200);
  assert.equal(body.result.structuredContent.case_state.case_id, SYNTHETIC_CASE_ID);
  assert.deepEqual(Object.keys(body.result.structuredContent.therapy_rules).sort(), ["available", "note"]);
  assert.equal(body.result.structuredContent.therapy_rules.available, false);
  assert.match(body.result.structuredContent.therapy_rules.note, /unavailable on this server; do not improvise it/u);
});

test("the call trace names each tool and its outcome, without arguments, case references or content", async (t) => {
  const events = [];
  const marker = "synthetic-private-marker-172";
  const listener = await listen(t, { caseAccessService: openingService, callLog: (event) => events.push(event) });
  await post(listener.url, "tools/list");
  await post(listener.url, "tools/call", { name: "load_therapy_protocol", arguments: {} });
  const opened = await post(listener.url, "tools/call", { name: "load_case_context", arguments: { case_id: SYNTHETIC_CASE_ID, candidate_id: marker } });
  await post(listener.url, "tools/call", { name: `no_such_tool_${marker}`, arguments: { text: marker } });
  const failed = await post(listener.url, "tools/call", { name: "retrieve_case_evidence", arguments: { case_id: "synthetic-case-failing", query: marker } });
  assert.equal(failed.response.status, 422);
  assert.equal(failed.body.error.data.code, "free text that is not a code", "the response itself is unchanged");

  const denied = await listen(t, { callLog: (event) => events.push(event) });
  const refused = await post(denied.url, "tools/call", { name: "load_case_context", arguments: { case_id: marker } }, `token-${marker}`);
  assert.equal(JSON.stringify(refused.body).includes("therapy_rules"), false, "a refused opening carries no rules");
  const noProtocol = await listen(t, { therapyProtocol: null, callLog: (event) => events.push(event) });
  await post(noProtocol.url, "tools/call", { name: "load_therapy_protocol", arguments: {} });

  assert.deepEqual(events.map(({ tool, bearer, ok, code }) => [tool, bearer, ok, code]), [
    ["load_therapy_protocol", false, true, null],
    ["load_case_context", false, true, null],
    ["unknown", false, false, "MCP_TOOL_NOT_FOUND"],
    ["retrieve_case_evidence", false, false, "OTHER"],
    ["load_case_context", true, false, "AUTHENTICATION_REQUIRED"],
    ["load_therapy_protocol", false, false, "THERAPY_PROTOCOL_UNAVAILABLE"]
  ]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ["at", "bearer", "bytes_at_most", "code", "event", "ms", "ok", "tool"]);
    assert.equal(event.event, "tool_call");
    assert.ok(Number.isInteger(event.ms) && event.ms >= 0);
    assert.ok(Number.isInteger(Math.log2(event.bytes_at_most)), "the size is a power of two");
    assert.equal(new Date(event.at).toISOString(), event.at);
  }
  const size = Buffer.byteLength(`${JSON.stringify(opened.body)}\n`);
  assert.ok(events[1].bytes_at_most >= size && events[1].bytes_at_most < 2 * size, "the size class is the next power of two");
  const trace = JSON.stringify(events);
  for (const secret of [marker, SYNTHETIC_CASE_ID, "synthetic turn", "synthetic-case-failing", "free text", String(size)]) assert.equal(trace.includes(secret), false, secret);
});

test("a failing trace, thrown or rejected, never breaks a call, and a trace must be a function", async (t) => {
  for (const failing of [() => { throw new Error("synthetic trace failure"); }, async () => { throw new Error("synthetic async trace failure"); }]) {
    let calls = 0;
    const listener = await listen(t, { caseAccessService: openingService, callLog: (event) => { calls += 1; return failing(event); } });
    for (let round = 0; round < 2; round += 1) {
      const answered = await post(listener.url, "tools/call", { name: "load_case_context", arguments: { case_id: SYNTHETIC_CASE_ID } });
      assert.equal(answered.response.status, 200);
      assert.equal(answered.body.result.structuredContent.case_state.case_id, SYNTHETIC_CASE_ID);
    }
    assert.equal(calls, 2, "the trace was called for each call and the server kept answering");
  }
  assert.throws(() => createPrivateCaseMcpServer({ caseAccessService: openingService, callLog: "stderr" }), { name: "TypeError", message: /callLog must be a function/u });
});

test("an opened case's rules come first, and a field of the same name in the case's data never stands in for them", async (t) => {
  const protocol = loadTherapyProtocol();
  const spoofing = Object.freeze({ ...openingService, async loadCaseContext() { return { ...openedCase, therapy_rules: { available: true, note: "synthetic stand-in" } }; } });
  const listener = await listen(t, { caseAccessService: spoofing, therapyProtocol: protocol });
  const { body } = await post(listener.url, "tools/call", { name: "load_case_context", arguments: { case_id: SYNTHETIC_CASE_ID } });
  assert.equal(Object.keys(body.result.structuredContent)[0], "therapy_rules");
  assert.ok(body.result.content[0].text.startsWith('{"therapy_rules":{"available":true,'), "a host that shortens the text keeps the rules");
  assert.equal(body.result.structuredContent.therapy_rules.protocol_sha256, protocol.protocolSha256);
  assert.equal(JSON.stringify(body).includes("synthetic stand-in"), false);
});
