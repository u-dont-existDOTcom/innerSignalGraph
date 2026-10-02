import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeResultReader, claudeRunSlug, MAX_CLAUDE_LINE_BYTES } from "../src/journal-import/claude-worker.mjs";
import { runProcess } from "../src/journal-import/codex-worker.mjs";
import { journalAttemptIdentity, writeAttemptMarker } from "../src/cli/journal-work.mjs";
import { journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";

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
    assert.equal(premature.state.reachedModel, true);
    assert.ok(!JSON.stringify(premature.state).includes("SYNTHETIC_PRIVATE_STREAM_SENTINEL"));
  }
  const bad = claudeResultReader(record);
  feed(bad, { ...init, tools: [...init.tools, "Bash"] });
  assert.equal(bad.state.bad, "ISOLATION");
  assert.equal(bad.state.reachedModel, false);
});

test("any result or nonzero usage reaches the model regardless of init position", () => {
  for (const event of [{ type: "result", is_error: true }, { type: "system", subtype: "usage", usage: { input_tokens: 1 } }]) {
    const reader = claudeResultReader(record);
    feed(reader, event);
    assert.equal(reader.state.reachedModel, true);
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
    assert.equal(journalAttemptIdentity(journalExchangeWorkId("synthetic-operation", successor)),
      journalExchangeWorkId("synthetic-operation"));
  }
  assert.equal(journalAttemptIdentity("job:synthetic-work"), "job:synthetic-work");
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
