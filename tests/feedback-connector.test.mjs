import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateCaseMcpServer, listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { createFeedbackFromEnvironment } from "../src/feedback/setup.mjs";
import { FEEDBACK_PAGE_URL, feedbackAddressInRules } from "../src/feedback/address.mjs";
import { generateOwnerKeyPair, openSealedForOwner, readOwnerPrivateKey } from "../src/feedback/open-sealed.mjs";
import { EMERGENCY_LINE, crisisLines } from "../src/feedback/page.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";

// The feedback place through the real connector server: switches off, the closed page, the page, the owner's routes and the chat
// tool. Synthetic texts only; MARKER must never appear in a trace line or an owner answer.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "synthetic-feedback-marker-90ab";
const RESOURCE = "https://private-mcp.synthetic.example";
const ISSUER = "https://identity.synthetic.example";
const PUBLIC_URL = "https://feedback.synthetic.example/feedback";
const deniedService = Object.freeze({
  async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
  async loadCaseContextByAlias() { throw new PrivateCaseAccessDeniedError(); },
  async authenticate() { return null; }
});
const protocolNaming = (address) => ({ version: "0.0.0-synthetic", protocolId: "synthetic", protocolSha256: "0".repeat(64), instructions: `Rules. Feedback page (${address}): synthetic.`, files: [] });

async function feedbackEnvironment(t, { tool = false } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-connector-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "feedback");
  await fs.mkdir(root, { mode: 0o700 });
  const pair = generateOwnerKeyPair();
  const token = randomBytes(32).toString("base64url");
  let clock = Date.parse("2026-11-22T10:00:00Z");
  const feedback = await createFeedbackFromEnvironment({
    repositoryRoot,
    now: () => clock,
    environment: {
      INNER_SIGNAL_FEEDBACK: "on",
      INNER_SIGNAL_FEEDBACK_TOOL: tool ? "on" : "off",
      INNER_SIGNAL_FEEDBACK_ROOT: root,
      INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY: pair.publicKey,
      INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256: createHash("sha256").update(token).digest("hex"),
      INNER_SIGNAL_FEEDBACK_PUBLIC_URL: PUBLIC_URL
    }
  });
  t.after(() => feedback.close());
  return { root, pair, token, feedback, advance: (ms) => { clock += ms; }, privateKey: readOwnerPrivateKey(pair) };
}

async function listen(t, options) {
  const listener = await listenPrivateCaseMcp({ caseAccessService: deniedService, therapyProtocol: null, ...options });
  t.after(() => listener.close());
  return { ...listener, origin: listener.url.replace(/\/mcp$/u, "") };
}

async function rpc(url, method, params = {}, token = null) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { response, body: await response.json() };
}

const form = (fields) => new URLSearchParams(fields).toString();
const postForm = (url, fields) => fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(fields) });
const tokenIn = (html) => /name="form_token" value="([^"]+)"/u.exec(html)?.[1];
const codeIn = (html) => /class="code">([0-9A-Z-]{19})</u.exec(html)?.[1];

test("with the feedback place off, the connector is as before: no /feedback, no tool, nothing in /health or initialize", async (t) => {
  const off = await listen(t, {});
  const health = await (await fetch(`${off.origin}/health`)).json();
  assert.equal("feedback" in health, false);
  for (const pathname of ["/feedback", "/feedback/delete", "/feedback/owner/events"]) {
    const response = await fetch(`${off.origin}${pathname}`);
    assert.equal(response.status, 404, pathname);
    assert.deepEqual(await response.json(), { error: "Not found." });
  }
  const names = (await rpc(off.url, "tools/list")).body.result.tools.map((tool) => tool.name);
  assert.equal(names.includes("send_feedback"), false);
  assert.doesNotMatch((await rpc(off.url, "initialize")).body.result.instructions, /send_feedback/u);
  const refused = await rpc(off.url, "tools/call", { name: "send_feedback", arguments: { kind: "praise", text: "x", person_approved_exact_text: true } });
  assert.equal(refused.response.status, 422);
  assert.equal(refused.body.error.data.code, "MCP_TOOL_NOT_FOUND");
});

test("when the served rules name the address and the page is off, every /feedback path is a closed page with the crisis lines", async (t) => {
  assert.equal(feedbackAddressInRules(protocolNaming(FEEDBACK_PAGE_URL)), FEEDBACK_PAGE_URL);
  assert.equal(feedbackAddressInRules({ instructions: "See https://example.org/feedbackform and https://example.org/x/feedback.", files: [] }), null, "only a path of exactly /feedback counts");
  const closed = await listen(t, { therapyProtocol: protocolNaming(FEEDBACK_PAGE_URL) });
  for (const [method, pathname] of [["GET", "/feedback"], ["POST", "/feedback"], ["GET", "/feedback/delete"], ["GET", "/feedback/owner/events"]]) {
    const response = await fetch(`${closed.origin}${pathname}`, { method, ...(method === "POST" ? { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "text=x" } : {}) });
    assert.equal(response.status, 503, `${method} ${pathname}`);
    const html = await response.text();
    assert.match(html, /Feedback is closed for now/u);
    assert.ok(html.includes("112 in the EU"));
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/u);
  }
  assert.deepEqual((await (await fetch(`${closed.origin}/health`)).json()).feedback, { page: "closed", tool: "off" });
  assert.equal((await fetch(`${closed.origin}/elsewhere`)).status, 404, "other paths are unchanged");
});

test("the page's address must equal the one the served rules name", async (t) => {
  const environment = await feedbackEnvironment(t);
  assert.throws(() => createPrivateCaseMcpServer({ caseAccessService: deniedService, therapyProtocol: protocolNaming("https://other.synthetic.example/feedback"), feedback: environment.feedback }),
    /must equal the feedback address the served rules name/u);
  assert.doesNotThrow(() => createPrivateCaseMcpServer({ caseAccessService: deniedService, therapyProtocol: protocolNaming(PUBLIC_URL), feedback: environment.feedback }).close());
  assert.doesNotThrow(() => createPrivateCaseMcpServer({ caseAccessService: deniedService, therapyProtocol: null, feedback: environment.feedback }).close(), "rules that name no address are fine");
});

test("the page: a send, a repeat, the hidden field, early and late tokens, sizes, and deletion by code", async (t) => {
  const environment = await feedbackEnvironment(t);
  const server = await listen(t, { feedback: environment.feedback });
  const page = await fetch(`${server.origin}/feedback`);
  assert.equal(page.status, 200);
  for (const [name, value] of [["cache-control", /no-store/u], ["x-frame-options", /DENY/u], ["x-robots-tag", /noindex/u], ["content-security-policy", /style-src 'sha256-/u]]) {
    assert.match(page.headers.get(name), value, name);
  }
  const html = await page.text();
  assert.ok(html.includes(EMERGENCY_LINE.replace(/^In danger right now\? /u, "")));
  assert.equal(html.split(crisisLines()).length - 1, 2, "the crisis lines, with the crisis-line directory, above the form and at the end");
  // Checked apart from crisisLines() too, so a directory dropped from that function fails here.
  const linkTargets = [...html.matchAll(/<a href="([^"]*)">/gu)].map((match) => match[1]);
  assert.equal(linkTargets.filter((target) => target === "https://findahelpline.com").length, 2, "the crisis-line directory's link, twice");
  assert.match(html, /What&#39;s kept:/u);
  // The browser counts UTF-16 units: 5,000 emoji (10,000 units) must fit the form, as they fit the server's 5,000 characters.
  assert.match(html, /<textarea id="text" name="text" maxlength="10000" required>/u);
  assert.match(html, /name="reply_address" maxlength="400"/u);
  assert.doesNotMatch(html, /<script/u);
  const token = tokenIn(html);
  assert.ok(token);
  const fields = { form_token: token, kind: "bug", text: `It froze ${MARKER}`, reply_address: "", extra: "" };

  // Too early: the form comes back with the words in it, nothing is stored.
  const early = await postForm(`${server.origin}/feedback`, fields);
  assert.equal(early.status, 400);
  assert.ok((await early.text()).includes(`It froze ${MARKER}`));
  environment.advance(3_000);

  // The hidden field filled: the form comes back, never a false "sent".
  const trapped = await postForm(`${server.origin}/feedback`, { ...fields, extra: "filled" });
  assert.equal(trapped.status, 400);
  assert.match(await trapped.text(), /please press Send once more/u);

  // The public tick on a suggestion is refused with the words kept.
  const ticked = await postForm(`${server.origin}/feedback`, { ...fields, kind: "suggestion", may_show_publicly: "yes" });
  assert.equal(ticked.status, 400);
  assert.match(await ticked.text(), /Only a review can be shown publicly/u);

  const sent = await postForm(`${server.origin}/feedback`, fields);
  assert.equal(sent.status, 200);
  const thanks = await sent.text();
  const code = codeIn(thanks);
  assert.ok(code, "the thank-you page shows the code");
  assert.doesNotMatch(thanks, new RegExp(`href="[^"]*${code.slice(0, 4)}`, "u"), "no link carries the code");
  const repeat = await postForm(`${server.origin}/feedback`, fields);
  assert.equal(codeIn(await repeat.text()), code, "a second press shows the same code and stores nothing more");
  const items = await fs.readdir(path.join(environment.root, "items"));
  assert.equal(items.length, 1);

  // Too large: refused and the connection closed.
  const large = await postForm(`${server.origin}/feedback`, { ...fields, text: "x".repeat(70_000) });
  assert.equal(large.status, 413);
  assert.equal(large.headers.get("connection"), "close");

  // A GET never reads a code from the address; a POST deletes.
  await fetch(`${server.origin}/feedback/delete?code=${encodeURIComponent(code)}`);
  assert.equal((await fs.readdir(path.join(environment.root, "items"))).length, 1);
  const deleted = await postForm(`${server.origin}/feedback/delete`, { code });
  assert.equal(deleted.status, 200);
  assert.match(await deleted.text(), /Deleted\./u);
  assert.deepEqual(await fs.readdir(path.join(environment.root, "items")), []);
  const again = await postForm(`${server.origin}/feedback/delete`, { code });
  assert.match(await again.text(), /No message has that code/u);
  const reviews = await (await fetch(`${server.origin}/feedback/reviews`)).text();
  assert.match(reviews, /No reviews are shown yet/u);
});

test("the owner's routes need the token, are limited after wrong ones, and answer sealed data only", async (t) => {
  const environment = await feedbackEnvironment(t);
  const server = await listen(t, { feedback: environment.feedback });
  const html = await (await fetch(`${server.origin}/feedback`)).text();
  environment.advance(3_000);
  await postForm(`${server.origin}/feedback`, { form_token: tokenIn(html), kind: "praise", text: `Thanks ${MARKER}`, extra: "" });

  const events = (token) => fetch(`${server.origin}/feedback/owner/events?after=0&confirmed=0`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  assert.equal((await events(null)).status, 401);
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await events(randomBytes(32).toString("base64url"))).status, 401);
  assert.equal((await events(randomBytes(32).toString("base64url"))).status, 429, "past five wrong tokens");
  const right = await events(environment.token);
  assert.equal(right.status, 200, "the right token always works");
  const body = await right.json();
  assert.equal(JSON.stringify(body).includes(MARKER), false, "sealed only");
  assert.equal(body.events.length, 1);
  const event = body.events[0];
  const record = { format: event.format, id: event.id, seq: event.seq, received_day: event.received_day, via: event.via, key_id: event.key_id, public_review: event.public_review };
  assert.equal(openSealedForOwner({ ownerPrivateKey: environment.privateKey, id: event.id, record, sealed: event.sealed }).text, `Thanks ${MARKER}`);
  assert.equal(body.counts.hidden_field_hits, 0);
  const bad = await fetch(`${server.origin}/feedback/owner/events?after=x`, { headers: { authorization: `Bearer ${environment.token}` } });
  assert.equal(bad.status, 400);
});

test("the chat tool: off by default, on behind its switch, no sign-in, the yes required, public reviews refused, stored text echoed", async (t) => {
  const offTool = await feedbackEnvironment(t, { tool: false });
  const pageOnly = await listen(t, { feedback: offTool.feedback, oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] } });
  assert.equal((await rpc(pageOnly.url, "tools/list")).body.result.tools.some((tool) => tool.name === "send_feedback"), false, "the page alone adds no tool");

  const environment = await feedbackEnvironment(t, { tool: true });
  const trace = [];
  const server = await listen(t, { feedback: environment.feedback, callLog: (event) => trace.push(event), oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] } });
  const tools = (await rpc(server.url, "tools/list")).body.result.tools;
  const tool = tools.at(-1);
  assert.equal(tool.name, "send_feedback", "the tool comes last");
  assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }]);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  assert.equal("may_show_publicly" in tool.inputSchema.properties, false);
  assert.match(tool.description, /only after you have shown the person, in the chat, the exact text/u);
  assert.match(tool.description, /want to die or might act, don't offer this tool/u);
  assert.match(tool.description, new RegExp(PUBLIC_URL.replaceAll(".", "\\."), "u"));
  assert.deepEqual(tools.slice(0, 2).map((entry) => entry.name), ["get_therapy_protocol_manifest", "load_therapy_protocol"], "the protocol tools stay first");
  assert.match((await rpc(server.url, "initialize")).body.result.instructions, /send_feedback is the one InnerSignal tool that sends something/u);

  const call = (args, token = null) => rpc(server.url, "tools/call", { name: "send_feedback", arguments: args }, token);
  const notApproved = await call({ kind: "praise", text: "x", person_approved_exact_text: false });
  assert.equal(notApproved.body.result.isError, true);
  assert.equal(notApproved.body.result.structuredContent.code, "FEEDBACK_NOT_APPROVED");
  const publicReview = await call({ kind: "review", text: "x", may_show_publicly: true, person_approved_exact_text: true });
  assert.equal(publicReview.body.result.structuredContent.code, "FEEDBACK_PUBLIC_ONLY_ON_PAGE");
  assert.equal(publicReview.body.result.content[0].text, `Not sent. A review that may be shown publicly is written by the person on the feedback page (${PUBLIC_URL}) in their own words; from a chat, a review can be sent only privately.`);
  const empty = await call({ kind: "praise", text: "   ", person_approved_exact_text: true });
  assert.equal(empty.body.result.structuredContent.code, "FEEDBACK_TEXT_INVALID");

  const sent = await call({ kind: "suggestion", text: `Add a dark mode ${MARKER}`, reply_address: "someone@example.invalid", person_approved_exact_text: true }, "a-bearer-token-that-is-ignored");
  assert.equal(sent.response.status, 200);
  const value = sent.body.result.structuredContent;
  assert.deepEqual(value.stored, { kind: "suggestion", text: `Add a dark mode ${MARKER}`, reply_address: "someone@example.invalid" });
  assert.match(value.deletion_code, /^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}$/u);
  assert.equal(value.reaches_maker_after, "2026-11-22T11:00:00Z");
  assert.match(sent.body.result.content[0].text, /It reaches InnerSignal's maker after about an hour/u);
  assert.match(sent.body.result.content[0].text, /Their chat keeps its own copy/u);

  // The owner's read holds it for the hour; its trace line has the hour only and no token flag, and no words.
  const held = await (await fetch(`${server.origin}/feedback/owner/events?after=0&confirmed=0`, { headers: { authorization: `Bearer ${environment.token}` } })).json();
  assert.deepEqual([held.events.length, held.held], [0, 1]);
  const line = trace.find((event) => event.tool === "send_feedback" && event.ok === true);
  assert.equal("bearer" in line, false);
  assert.match(line.at, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/u);
  assert.equal(JSON.stringify(trace).includes(MARKER), false);
  const other = trace.find((event) => event.tool === "unknown" || event.tool === "load_therapy_protocol");
  if (other) assert.equal("bearer" in other, true, "other tools' lines are unchanged");
  environment.advance(3_600_000);
  const released = await (await fetch(`${server.origin}/feedback/owner/events?after=0&confirmed=0`, { headers: { authorization: `Bearer ${environment.token}` } })).json();
  assert.equal(released.events.length, 1);
  assert.equal(released.events[0].via, "chat");
});

test("parallel sends can't slip under the limits, one form can't store two messages, and an early refusal closes the connection", async (t) => {
  const environment = await feedbackEnvironment(t, { tool: true });
  const server = await listen(t, { feedback: environment.feedback });
  const calls = await Promise.all(Array.from({ length: 15 }, (_, index) => rpc(server.url, "tools/call", {
    name: "send_feedback", arguments: { kind: "praise", text: `parallel ${index}`, person_approved_exact_text: true }
  })));
  const accepted = calls.filter((call) => call.body.result.isError === false).length;
  assert.equal(accepted, 10, "the chat's ten per ten minutes per client, even all at once");
  assert.equal(calls.filter((call) => call.body.result.structuredContent?.code === "FEEDBACK_BUSY").length, 5);
  assert.equal((await fs.readdir(path.join(environment.root, "items"))).length, 10);

  const html = await (await fetch(`${server.origin}/feedback`)).text();
  environment.advance(3_000);
  const fields = { form_token: tokenIn(html), kind: "bug", text: "twice at once", extra: "" };
  const [first, second] = await Promise.all([postForm(`${server.origin}/feedback`, fields), postForm(`${server.origin}/feedback`, fields)]);
  const codes = [codeIn(await first.text()), codeIn(await second.text())];
  assert.ok(codes[0]);
  assert.equal(codes[0], codes[1], "both answers show the one code");
  assert.equal((await fs.readdir(path.join(environment.root, "items"))).length, 11, "one message stored");

  const refused = await fetch(`${server.origin}/feedback/owner/delete`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong-token-of-enough-length" }, body: JSON.stringify({ id: "x" }) });
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get("connection"), "close", "a body-bearing request refused before its body is read closes the connection");
  const page = await fetch(`${server.origin}/feedback`);
  assert.notEqual(page.headers.get("connection"), "close", "a GET keeps the connection");
});

test("a root that can't be read stops startup with the setting's name, never its path", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-root-"));
  const locked = path.join(base, "locked-secret-path-name");
  t.after(async () => { await fs.chmod(locked, 0o700).catch(() => {}); await fs.rm(base, { recursive: true, force: true }); });
  await fs.mkdir(path.join(locked, "store"), { recursive: true, mode: 0o700 });
  await fs.chmod(locked, 0o000);
  const pair = generateOwnerKeyPair();
  const attempt = createFeedbackFromEnvironment({ repositoryRoot, environment: {
    INNER_SIGNAL_FEEDBACK: "on",
    INNER_SIGNAL_FEEDBACK_ROOT: path.join(locked, "store"),
    INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY: pair.publicKey,
    INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256: "0".repeat(64),
    INNER_SIGNAL_FEEDBACK_PUBLIC_URL: PUBLIC_URL
  } });
  await assert.rejects(attempt, (error) => {
    assert.match(error.message, /^INNER_SIGNAL_FEEDBACK_ROOT /u);
    assert.equal(error.message.includes("locked-secret-path-name"), false, error.message);
    return true;
  });
});

test("a GET that declares a body and is refused closes the connection too", async (t) => {
  const environment = await feedbackEnvironment(t);
  const server = await listen(t, { feedback: environment.feedback });
  const http = await import("node:http");
  const { origin } = server;
  const target = new URL(`${origin}/feedback/owner/events`);
  const result = await new Promise((resolve, reject) => {
    const request = http.request({ host: target.hostname, port: target.port, path: target.pathname, method: "GET", headers: { "content-length": "1000000" } }, (response) => {
      response.resume();
      resolve({ status: response.statusCode, connection: response.headers.connection });
    });
    request.on("error", reject);
    request.write("x".repeat(1_000));
  });
  assert.equal(result.status, 401);
  assert.equal(result.connection, "close");
});
