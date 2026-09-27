import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { captureNativeResponseSource, inspectFinalResponseSource } from "../src/journal-import/native-response-source.mjs";
import { ChatGptSubscriptionDesktopCdpTransport } from "../src/journal-import/chatgpt-subscription-desktop-cdp.mjs";
const source = JSON.stringify({ quote: 'She said "hello". C:\\folder\\file\n*literal* _text_ `code` café 日本語', empty: null }, null, 2);
const rendered = source.replace(/\\"/g, '"').replace(/\n/g, "");
const terminal = { userCount: 1, assistantCount: 1, assistantText: rendered,
  assistantDomText: rendered, finalAnswerReady: true, stop: false,
  composerFound: true, composerDisabled: false, workComposerFound: false };
function fixture({ raw = source, unchanged = true, count = 1, copyWorks = true } = {}) {
  let value = "", copies = 0;
  const clipboard = { write: x => { value = x; }, read: () => value };
  const snapshot = () => ({ roots: 1, user_turns: 1, copy_controls: count,
    dom_text: unchanged || copies === 0 ? rendered : "changed" });
  const client = { call: async fn => {
    if (fn.name === "inspectFinalResponseSource") return snapshot();
    if (fn.name === "clickFinalResponseCopy") { copies++; if (copyWorks) value = raw; return true; }
    throw new Error("Unexpected DOM call " + fn.name);
  }};
  return { client, clipboard, copies: () => copies, capture: () => captureNativeResponseSource({
    client, clipboard, expectedFinal: terminal, readResponseState: async () => terminal,
    readAttempts: 2, retryDelayMs: 1
  }) };
}

test("native Copy preserves JSON escapes, Unicode and line breaks without repair", async () => {
  const f = fixture(), result = await f.capture();
  assert.throws(() => JSON.parse(rendered));
  assert.equal(result.text, source);
  assert.deepEqual(JSON.parse(result.text), JSON.parse(source));
  assert.equal(f.copies(), 2);
  assert.equal(result.capture.original_bytes_modified, false);
});
test("a genuinely malformed original remains malformed", async () => {
  const result = await fixture({ raw: '{"quote":"bad "quote""}' }).capture();
  assert.throws(() => JSON.parse(result.text));
});
test("stale clipboard, ambiguous Copy and changed response are rejected", async () => {
  for (const options of [{ copyWorks: false }, { count: 2 }, { unchanged: false }]) {
    await assert.rejects(fixture(options).capture(), /NATIVE_RESPONSE_/);
  }
});
test("DOM witness distinguishes final assistant source from a user and tool block", () => {
  const dom = new JSDOM('<main><div class="bg-user-message">user</div><div><h4 class="sr-only">ChatGPT said:</h4><div><div class="_MarkdownRoot_">line<br>next</div></div><button aria-label="Copy"></button></div><section><div class="_MarkdownRoot_">tool</div></section></main>', { runScripts: "outside-only" });
  const got = dom.window.eval('(' + inspectFinalResponseSource.toString() + ')()');
  assert.equal(got.roots, 1); assert.equal(got.user_turns, 1);
  assert.equal(got.dom_text, 'linenext'); assert.equal(got.copy_controls, 1);
  dom.window.close();
});

test("actual runPacket completion persists native source rather than rendered text", async () => {
  let submitted = false, copies = 0, clipboardValue = "", front = false; const checkpoints = [];
  const clipboard = { write: x => { clipboardValue = x; }, read: () => clipboardValue };
  const client = { send: async method => { if (method === "Page.bringToFront") front = true; return {}; }, call: async fn => {
    switch (fn.name) {
      case "selectedToolState": return { selectedCount: 0 };
      case "attachmentRemoveState": return { count: 0 };
      case "sendControlState": return { count: 1, enabled: true };
      case "clickSendControl": submitted = true; return { ok: true };
      case "responseState": return submitted ? terminal : { ...terminal, userCount: 0, assistantCount: 0 };
      case "sourceToolState": return { count: 0, complete: true, external: false, unclassified: false };
      case "inspectFinalResponseSource": return { roots: 1, copy_controls: 1, user_turns: 1, dom_text: rendered };
      case "clickFinalResponseCopy": copies++; clipboardValue = source; return true;
      default: throw new Error("Unexpected DOM call " + fn.name);
    }
  }};
  const transport = new ChatGptSubscriptionDesktopCdpTransport({ clipboard, checkpoint: async row => checkpoints.push(row) });
  transport.withPage = fn => fn(client);
  for (const name of ["ensureChatMode", "startFreshUnpersonalizedTemporaryChat", "ensureModelAndEffort", "insertPrompt"]) transport[name] = async () => {};
  transport.ensureChatMode = async () => assert.equal(front, true, "focus the owned target before navigation");
  const prompt = "synthetic source only";
  const response = await transport.runPacket({ prompt,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    modelVisibleLabel: "synthetic-model", effortVisibleLabel: "Pro", attachments: [] });
  assert.equal(response.text, source); assert.equal(copies, 2);
  assert.equal(checkpoints.at(-1).phase, "completed");
  assert.equal(checkpoints.at(-1).response.text, source);
  assert.equal(response.receipt.source_capture.method, "native-assistant-copy-v1");
});

test("Copy feedback may hide the Copy label without changing the response", async () => {
  const f = fixture(); const call = f.client.call.bind(f.client);
  let feedback = true;
  f.client.call = async (fn, args) => {
    const value = await call(fn, args);
    if (fn.name === "inspectFinalResponseSource" && f.copies() === 1 && feedback) {
      feedback = false; return { ...value, copy_controls: 0 };
    }
    return value;
  };
  assert.equal((await f.capture()).text, source);
});
