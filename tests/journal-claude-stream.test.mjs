import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeResultReader, claudeRunSlug, MAX_CLAUDE_LINE_BYTES } from "../src/journal-import/claude-worker.mjs";
import { runProcess } from "../src/journal-import/codex-worker.mjs";
import { journalAttemptIdentity, journalAttemptMarkerKey, writeAttemptMarker } from "../src/cli/journal-work.mjs";
import { journalWorkFileKey } from "../src/journal-import/work-exchange.mjs";
import { journalExchangeAttemptIdentity, journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";

const record = { work_id: "job:synthetic-stream", model: "claude-opus-5-5" };
const init = { type: "system", subtype: "init", claude_code_version: "2.1.287",
  mcp_servers: [{ name: "journal", status: "connected" }],
  tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
  skills: [], slash_commands: [], plugins: [], agents: [] };
const feed = (reader, event) => reader.accept(JSON.stringify(event));

test("content-free system events before init are accepted, and init alone never reaches the model", () => {
  const reader = claudeResultReader(record);
  feed(reader, { type: "system", subtype: "ui_invalidate" });
  feed(reader, init);
  assert.equal(reader.state.bad, null);
  assert.equal(reader.state.reachedModel, false);
  assert.equal(reader.state.claudeCodeVersion, "2.1.287");
  for (const type of ["assistant", "user"]) {
    const premature = claudeResultReader(record);
    feed(premature, { type, message: { content: "SYNTHETIC_PRIVATE_STREAM_SENTINEL" } });
    assert.equal(premature.state.bad, "ISOLATION");
    assert.equal(premature.state.reachedModel, false);
    assert.ok(!JSON.stringify(premature.state).includes("SYNTHETIC_PRIVATE_STREAM_SENTINEL"));
  }
  const bad = claudeResultReader(record);
  feed(bad, { ...init, tools: [...init.tools, "Bash"] });
  assert.equal(bad.state.bad, "ISOLATION");
  assert.equal(bad.state.reachedModel, false);
});

test("only token usage on a real model or a real tool use reaches the model", () => {
  for (const event of [{ type: "assistant", message: { model: record.model, usage: { input_tokens: 1 } } },
    { type: "result", modelUsage: { [record.model]: { outputTokens: 1 } } },
    { type: "tool_use", name: init.tools[0], input: { work_id: record.work_id } }]) {
    const reader = claudeResultReader(record);
    feed(reader, init);
    feed(reader, event);
    assert.equal(reader.state.reachedModel, true);
  }
  for (const event of [{ type: "result", is_error: true, usage: { input_tokens: 0, output_tokens: 0 } },
    { type: "user", message: { content: "SYNTHETIC_USER_SENTINEL" } },
    { type: "assistant", message: { model: "<synthetic>", usage: { input_tokens: 1 } } },
    { type: "assistant", message: { model: record.model, usage: { total_cost_usd: 1 } } }]) {
    const reader = claudeResultReader(record);
    feed(reader, init); feed(reader, event);
    assert.equal(reader.state.reachedModel, false);
  }
});

test("exact Claude limit event shapes, seconds/ms reset times and no-reset default evidence", () => {
  const reset = Date.now() + 1000;
  for (const [event, expected] of [
    [{ type: "assistant", error: "rate_limit" }, null],
    [{ type: "result", is_error: true, subtype: "success", api_error_status: 429 }, null],
    [{ type: "rate_limit_event", status: "limited", resetsAt: reset / 1000 }, reset],
    [{ type: "rate_limit_event", status: "limited", resetsAt: reset }, reset],
    [{ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: reset } }, reset]
  ]) {
    const reader = claudeResultReader(record);
    feed(reader, init);
    feed(reader, event);
    assert.equal(reader.state.limitSeen, true);
    assert.equal(reader.state.limitReset, expected);
  }
});

test("a 1.5 MB tool-result line preserves assistant fetch/submit and the final result", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "journal-stream-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const toolUse = name => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input: { work_id: record.work_id } }] } });
  const events = [init, toolUse(init.tools[0]),
    { type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(1_500_000) }] } },
    toolUse(init.tools[1]),
    { type: "result", is_error: false, subtype: "success", session_id: "12345678",
      modelUsage: { [record.model]: { outputTokens: 1 } } }];
  const fixture = path.join(directory, "events.json");
  await fs.writeFile(fixture, JSON.stringify(events));
  const reader = claudeResultReader(record);
  const result = await runProcess(process.execPath, ["--input-type=module", "-e",
    "import fs from 'node:fs'; for (const event of JSON.parse(fs.readFileSync(process.argv[1]))) console.log(JSON.stringify(event));", fixture],
  { cwd: directory, env: {}, timeoutMs: 5000, maxLineBytes: MAX_CLAUDE_LINE_BYTES, onLine: reader.accept });
  assert.equal(result.code, 0);
  assert.equal(result.problem, null);
  assert.equal(reader.state.bad, null);
  assert.equal(reader.state.packetBeforeFirstSubmit, true);
  assert.equal(reader.state.resultSeen, true);
  assert.ok(JSON.stringify(reader.state).length < 2000);
});

test("the first isolation violation kills the fake Claude and its group before a packet call", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "journal-stream-kill-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "packet-called");
  const reader = claudeResultReader(record);
  const result = await runProcess(process.execPath, ["--input-type=module", "-e",
    "import fs from 'node:fs'; import { spawn } from 'node:child_process'; " +
    "spawn(process.execPath, ['-e', \"setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'synthetic'), 500)\", process.argv[1]], {stdio:'ignore'}); " +
    "console.log(process.argv[2]); setTimeout(() => fs.writeFileSync(process.argv[1], 'synthetic'), 500);",
    marker, JSON.stringify({ ...init, skills: ["synthetic"] })],
  { cwd: directory, env: {}, timeoutMs: 5000, onLine: line => {
    reader.accept(line);
    return reader.state.bad !== "ISOLATION";
  } });
  assert.equal(result.code, null);
  assert.equal(reader.state.reachedModel, false);
  await new Promise(resolve => setTimeout(resolve, 650));
  await assert.rejects(fs.access(marker));
});

test("attempt identity survives expired-item successors, and Claude slugs match the measured mapping", () => {
  for (let successor = 0; successor <= 8; successor++) {
    assert.equal(journalAttemptIdentity({ work_id: journalExchangeWorkId("synthetic-operation", successor),
      attempt_identity: journalExchangeAttemptIdentity("synthetic-operation:resend:2") }),
      journalExchangeAttemptIdentity("synthetic-operation"));
  }
  for (const suffix of [":resend:1", ":resend:2", ":unsent-retry:0:1", ":reserialize", ":reserialize:1:resend:1"]) {
    assert.equal(journalExchangeAttemptIdentity("synthetic-operation" + suffix),
      journalExchangeAttemptIdentity("synthetic-operation"));
  }
  assert.throws(() => journalAttemptIdentity({ work_id: "job:synthetic-work" }),
    { code: "JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED" });
  assert.equal(journalAttemptMarkerKey(journalExchangeAttemptIdentity("synthetic-operation")),
    journalWorkFileKey(journalExchangeWorkId("synthetic-operation")));
  assert.equal(claudeRunSlug("/tmp/tmp.AbC"), "-tmp-tmp-AbC");
});

test("exclusive attempt writes expose only complete JSON and leave no temporary file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "journal-marker-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "attempt.json");
  const value = { work_id: record.work_id, claim: "synthetic-claim", status: "reserved" };
  const writes = await Promise.allSettled([writeAttemptMarker(marker, value, true), writeAttemptMarker(marker, value, true)]);
  assert.equal(writes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(writes.find(item => item.status === "rejected").reason.code, "EEXIST");
  assert.deepEqual(JSON.parse(await fs.readFile(marker, "utf8")), value);
  assert.deepEqual(await fs.readdir(directory), ["attempt.json"]);
  await writeAttemptMarker(marker, { ...value, status: "attempted" });
  assert.equal(JSON.parse(await fs.readFile(marker, "utf8")).status, "attempted");
  assert.deepEqual(await fs.readdir(directory), ["attempt.json"]);
});

test("five-megabyte stream lines tolerate loaded CI", async () => {
  const { boundedLineReader } = await import("../src/journal-import/codex-worker.mjs");
  const payload = JSON.stringify({ type: "user", content: "SYNTHETIC_LINE_SENTINEL".repeat(250_000) });
  assert.ok(Buffer.byteLength(payload) >= 5_000_000);
  let length = 0;
  const reader = boundedLineReader({ maxLineBytes: MAX_CLAUDE_LINE_BYTES,
    maxStreamBytes: 4 * MAX_CLAUDE_LINE_BYTES, onLine: line => { length = JSON.parse(line).content.length; } });
  const started = performance.now();
  for (let offset = 0; offset < payload.length; offset += 4096) {
    assert.equal(await reader.accept(payload.slice(offset, offset + 4096)), true);
  }
  await reader.accept("\n");
  const elapsed = performance.now() - started;
  assert.equal(length, 250_000 * "SYNTHETIC_LINE_SENTINEL".length);
  assert.ok(elapsed < 5000, `five-megabyte line took ${elapsed.toFixed(1)} ms`);
});

test("packet tool results retain only exact lengths and reject a preview", () => {
  for (const content of ["SYNTHETIC_FULL_PACKET", "PREVIEW"]) {
    const reader = claudeResultReader(record, "SYNTHETIC_FULL_PACKET".length);
    feed(reader, init);
    feed(reader, { type: "assistant", message: { model: record.model, content: [{ type: "tool_use",
      id: "packet-call", name: init.tools[0], input: { work_id: record.work_id } }] } });
    // An unrelated tool's text cannot satisfy the packet check.
    feed(reader, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "other",
      content: "SYNTHETIC_FULL_PACKET" }] } });
    assert.equal(reader.state.packetLength, null);
    feed(reader, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "packet-call",
      content: [{ type: "text", text: content }] }] } });
    assert.equal(reader.state.packetLength, content.length);
    assert.equal(reader.state.bad, content === "PREVIEW" ? "PACKET_TRUNCATED" : null);
    assert.ok(!JSON.stringify(reader.state).includes(content));
  }
});

for (const status of [401, 403, 500, 503, 529]) {
  test(`real CLI synthetic assistant and zero-usage error result for HTTP ${status} never reach the model`, () => {
    const reader = claudeResultReader(record);
    feed(reader, init);
    feed(reader, { type: "assistant", error: "api_error", message: { model: "<synthetic>",
      usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "text",
        text: `API Error: ${status} SYNTHETIC_PROVIDER_SENTINEL` }] } });
    feed(reader, { type: "result", is_error: true, subtype: "success", api_error_status: status,
      usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {}, errors: [`API Error: ${status}`] });
    assert.equal(reader.state.reachedModel, false);
    assert.equal(reader.state.providerStatus, status);
    assert.ok(!JSON.stringify(reader.state).includes("SYNTHETIC_PROVIDER_SENTINEL"));
  });
}
