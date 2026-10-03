import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeResultReader, claudeRunSlug, MAX_CLAUDE_LINE_BYTES, processGroupHasLiveMember, processGroupsWorkingIn, recordedOwnerAlive, sweepClaudeProcessGroups, waitForProcessGroupGone } from "../src/journal-import/claude-worker.mjs";
import { lockWorkerDirectory, runProcess } from "../src/journal-import/codex-worker.mjs";
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
  const toolUse = (name, id) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: { work_id: record.work_id } }] } });
  const events = [init, toolUse(init.tools[0], "toolu_get"),
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_get", content: "x".repeat(1_500_000) }] } },
    toolUse(init.tools[1], "toolu_submit"),
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
  // Like Claude Code, a character outside the BMP is two UTF-16 code units and so two dashes.
  assert.equal(claudeRunSlug("/tmp/a\u{1F600}b"), "-tmp-a--b");
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

test("a submit issued before the fetch result arrived is not packet-backed", () => {
  const fetchUse = { type: "tool_use", id: "toolu_fetch", name: "mcp__journal__get_journal_work_packet", input: { work_id: record.work_id } };
  const submitUse = { type: "tool_use", id: "toolu_submit", name: "mcp__journal__submit_journal_work_result", input: { work_id: record.work_id } };
  const fetchResult = { type: "tool_result", tool_use_id: "toolu_fetch", content: "x".repeat(10) };
  // Parallel calls: fetch and submit in one assistant event, results afterwards.
  const parallel = claudeResultReader(record, 10);
  feed(parallel, init);
  feed(parallel, { type: "assistant", message: { model: record.model, content: [fetchUse, submitUse] } });
  feed(parallel, { type: "user", message: { content: [fetchResult] } });
  assert.equal(parallel.state.packetBeforeFirstSubmit, false);
  // Sequential calls: the fetch result precedes the submit.
  const sequential = claudeResultReader(record, 10);
  feed(sequential, init);
  feed(sequential, { type: "assistant", message: { model: record.model, content: [fetchUse] } });
  feed(sequential, { type: "user", message: { content: [fetchResult] } });
  feed(sequential, { type: "assistant", message: { model: record.model, content: [submitUse] } });
  assert.equal(sequential.state.packetBeforeFirstSubmit, true);
  // A failed fetch result does not count.
  const failed = claudeResultReader(record, null);
  feed(failed, init);
  feed(failed, { type: "assistant", message: { model: record.model, content: [fetchUse] } });
  feed(failed, { type: "user", message: { content: [{ ...fetchResult, is_error: true }] } });
  feed(failed, { type: "assistant", message: { model: record.model, content: [submitUse] } });
  assert.equal(failed.state.packetBeforeFirstSubmit, false);
});

test("a recorded process group is killed and confirmed gone before persistence is scanned", async () => {
  const { spawn } = await import("node:child_process");
  // A detached group whose leader spawns a lingering member, standing in for an MCP helper.
  const leader = spawn(process.execPath, ["-e",
    "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); setInterval(() => {}, 1000);"],
  { detached: true, stdio: "ignore" });
  await new Promise(resolve => setTimeout(resolve, 300));
  const started = Date.now();
  assert.equal(await waitForProcessGroupGone(leader.pid, 5000), true);
  // On hosts whose PID 1 doesn't reap, killed members can linger as zombies; none may still run.
  assert.equal(await processGroupHasLiveMember(leader.pid), false);
  assert.ok(Date.now() - started < 5000);
  // An already-gone group and a missing record are both treated as gone.
  assert.equal(await waitForProcessGroupGone(leader.pid, 100), true);
  assert.equal(await waitForProcessGroupGone(null), true);
});

test("startup recovery kills a recorded group whose leader exited but whose helper survives", async (t) => {
  const { spawn } = await import("node:child_process");
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-sweep-leader-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const workDir = path.join(base, "work"), home = path.join(base, "home");
  const runDir = path.join(workDir, "inner-signal-claude-ABCDEF", "run-GHIJKL");
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(workDir, "inner-signal-claude-ABCDEF"), 0o700);
  await fs.mkdir(home, { mode: 0o700 });
  // A detached leader spawns a same-group helper and exits at once.
  const leader = spawn(process.execPath, ["-e",
    "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }).unref();"],
  { detached: true, stdio: "ignore" });
  const pgid = leader.pid;
  const start = (await fs.readFile(`/proc/${pgid}/stat`, "utf8")).split(") ")[1].trim().split(/\s+/u)[19];
  await new Promise(resolve => leader.once("exit", resolve));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await processGroupHasLiveMember(pgid), true, "the helper must still be alive in the group");
  // The recorded owner is a worker that no longer exists.
  await fs.writeFile(path.join(runDir, "process-group.json"),
    JSON.stringify({ owner: { pid: 2147483646, start: "0" }, child: { pid: pgid, start } }), { mode: 0o600 });
  await sweepClaudeProcessGroups(workDir, home);
  assert.equal(await processGroupHasLiveMember(pgid), false);
  await assert.rejects(fs.access(runDir));
});

test("a process group whose only remaining members are zombies counts as gone", async (t) => {
  const proc = await fs.mkdtemp(path.join(os.tmpdir(), "journal-fake-proc-"));
  t.after(() => fs.rm(proc, { recursive: true, force: true }));
  const write = async (pid, comm, state, pgrp) => {
    await fs.mkdir(path.join(proc, String(pid)), { recursive: true });
    await fs.writeFile(path.join(proc, String(pid), "stat"), `${pid} (${comm}) ${state} 1 ${pgrp} ${pgrp} 0 -1 0 0 0 0 0 0 0 0 0 0 1 0 12345 0 0`);
  };
  await write(101, "node helper", "Z", 4242);
  await write(102, "odd ) name", "Z", 4242);
  await write(103, "other", "S", 7777);
  await fs.writeFile(path.join(proc, "self"), "not a process directory");
  assert.equal(await processGroupHasLiveMember(4242, proc), false, "zombie-only group");
  await write(104, "still running", "D", 4242);
  assert.equal(await processGroupHasLiveMember(4242, proc), true, "a member in uninterruptible sleep can still act");
  assert.equal(await processGroupHasLiveMember(5555, proc), false, "no members at all");
  assert.equal(await processGroupHasLiveMember(4242, path.join(proc, "missing")), true, "unreadable /proc keeps waiting");
});

test("processes working inside a run directory are found by their cwd", async (t) => {
  const proc = await fs.mkdtemp(path.join(os.tmpdir(), "journal-fake-proc-cwd-"));
  t.after(() => fs.rm(proc, { recursive: true, force: true }));
  const run = path.join(proc, "work", "run-ABCDEF");
  await fs.mkdir(path.join(run, "cache"), { recursive: true });
  const add = async (pid, cwd, state, pgrp) => {
    await fs.mkdir(path.join(proc, String(pid)), { recursive: true });
    await fs.symlink(cwd, path.join(proc, String(pid), "cwd"));
    await fs.writeFile(path.join(proc, String(pid), "stat"), `${pid} (x) ${state} 1 ${pgrp} ${pgrp} 0`);
  };
  await add(201, run, "S", 900);
  await add(202, path.join(run, "cache"), "R", 901);
  await add(203, path.join(run, "cache"), "Z", 902);
  await add(204, path.join(proc, "work", "run-ABCDEFG"), "S", 903);
  assert.deepEqual([...await processGroupsWorkingIn(run, proc)].sort(), [900, 901]);
  assert.equal(await processGroupsWorkingIn(run, path.join(proc, "missing")), null);
});

for (const held of [false, true]) {
  test(`startup recovery ${held ? "leaves" : "kills"} a markerless run whose worker lock is ${held ? "held" : "free"}`, async (t) => {
    const { spawn } = await import("node:child_process");
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-markerless-"));
    const workDir = path.join(base, "work"), home = path.join(base, "home");
    const parent = path.join(workDir, "inner-signal-claude-MRKLSS"), runDir = path.join(parent, "run-ORPHAN");
    await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
    await fs.chmod(parent, 0o700);
    await fs.mkdir(home, { mode: 0o700 });
    const unlock = held ? await lockWorkerDirectory(parent) : null;
    if (!held) await fs.writeFile(path.join(parent, "worker.lock"), "", { mode: 0o600 });
    // The orphan: a detached process working in the run directory, with no process-group.json written.
    const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: runDir, detached: true, stdio: "ignore" });
    t.after(async () => {
      try { process.kill(-orphan.pid, "SIGKILL"); } catch { /* gone */ }
      if (unlock) await unlock();
      await fs.rm(base, { recursive: true, force: true });
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    const unresolved = await sweepClaudeProcessGroups(workDir, home);
    assert.equal(unresolved.size, 0);
    if (held) {
      await fs.access(runDir);
      assert.equal(await processGroupHasLiveMember(orphan.pid), true, "a live worker's run is left alone");
    } else {
      await assert.rejects(fs.access(runDir));
      assert.equal(await processGroupHasLiveMember(orphan.pid), false, "the orphan is killed before the scan");
    }
  });
}

test("startup recovery fails closed on a markerless run whose worker lock is not a private file", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-markerless-badlock-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const workDir = path.join(base, "work"), home = path.join(base, "home");
  const parent = path.join(workDir, "inner-signal-claude-BADLCK"), runDir = path.join(parent, "run-ORPHAN");
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  await fs.chmod(parent, 0o700);
  await fs.mkdir(home, { mode: 0o700 });
  await fs.writeFile(path.join(parent, "worker.lock"), "");
  await fs.chmod(path.join(parent, "worker.lock"), 0o644);
  const unresolved = await sweepClaudeProcessGroups(workDir, home);
  assert.deepEqual([...unresolved], ["inner-signal-claude-BADLCK"]);
  await fs.access(runDir);
});

test("with a reserved session, init without it or any event reporting another value refuses the run", () => {
  const record = { model: "claude-opus-5-5", work_id: "job:synthetic" };
  const expected = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const init = { type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
    tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"], skills: [], slash_commands: [] };
  const result = { type: "result", is_error: false, subtype: "success", modelUsage: { "claude-opus-5-5": { outputTokens: 1 } } };
  const accepted = claudeResultReader(record, null, expected);
  accepted.accept(JSON.stringify({ ...init, session_id: expected }));
  accepted.accept(JSON.stringify({ ...result, session_id: expected }));
  assert.equal(accepted.state.bad, null);
  assert.equal(accepted.state.session, expected);
  // Init without the session, or any event carrying a different, null or malformed one, is an isolation failure
  // (the worker kills the run at once); a result that omits it is invalid.
  for (const [events, bad, mismatch] of [
    [[{ ...init, session_id: "12345678" }, { ...result, session_id: expected }], "ISOLATION", true],
    [[{ ...init }, { type: "assistant", message: { content: [] }, session_id: expected }], "ISOLATION", true],
    [[{ ...init, session_id: expected }, { ...result, session_id: "12345678" }], "ISOLATION", true],
    [[{ ...init, session_id: expected }, { type: "system", subtype: "status", session_id: null }, { ...result, session_id: expected }],
      "ISOLATION", true],
    [[{ ...init, session_id: expected }, { type: "system", subtype: "status", session_id: 7 }], "ISOLATION", true],
    [[{ ...init, session_id: expected }, { ...result }], "SESSION_INVALID", false]]) {
    const reader = claudeResultReader(record, null, expected);
    for (const event of events) reader.accept(JSON.stringify(event));
    assert.equal(reader.state.bad, bad);
    assert.equal(reader.state.sessionMismatch, mismatch);
  }
});

test("a gated command starts only after onSpawn, and never if onSpawn fails", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-gate-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, "started");
  const command = ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`];
  let startedBeforeRelease = null;
  const released = await runProcess(process.execPath, command, { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 10_000,
    onLine: () => {}, gate: true, onSpawn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      startedBeforeRelease = await fs.access(marker).then(() => true, () => false);
    } });
  assert.equal(startedBeforeRelease, false);
  assert.equal(released.code, 0);
  await fs.access(marker);
  await fs.rm(marker);
  const refused = await runProcess(process.execPath, command, { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 10_000,
    onLine: () => {}, gate: true, onSpawn: async () => { throw new Error("record failed"); } });
  assert.equal(refused.problem, "PROCESS_RECORD_FAILED");
  await assert.rejects(fs.access(marker), "the command never ran");
});

test("a gated command never starts if its parent dies before release", async (t) => {
  const { spawn } = await import("node:child_process");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-gate-death-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, "started");
  const workerModule = new URL("../src/journal-import/codex-worker.mjs", import.meta.url).href;
  // The parent records the gate shell's group, then is killed inside onSpawn, before it can release the gate.
  const script = `import { runProcess } from ${JSON.stringify(workerModule)};
import fs from "node:fs";
await runProcess(process.execPath, ["-e", ${JSON.stringify(`require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`)}],
  { cwd: ${JSON.stringify(dir)}, env: { PATH: process.env.PATH }, timeoutMs: 10000, onLine: () => {}, gate: true,
    onSpawn: (pid) => { fs.writeFileSync(${JSON.stringify(path.join(dir, "group"))}, String(pid)); process.kill(process.pid, "SIGKILL"); } });`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
  await new Promise((resolve) => parent.once("close", resolve));
  const group = Number(await fs.readFile(path.join(dir, "group"), "utf8"));
  const deadline = Date.now() + 5_000;
  while (await processGroupHasLiveMember(group) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await processGroupHasLiveMember(group), false, "the gate shell exits when its parent dies");
  await assert.rejects(fs.access(marker), "the command never ran");
});

test("a recorded owner counts as alive only while running with the recorded start time", () => {
  const record = { owner: { pid: 4242, start: "777" } };
  for (const state of ["R", "S", "D", "T"]) assert.equal(recordedOwnerAlive({ pid: 4242, start: "777", state }, record), true);
  for (const state of ["Z", "X", "x"]) assert.equal(recordedOwnerAlive({ pid: 4242, start: "777", state }, record), false, state);
  assert.equal(recordedOwnerAlive({ pid: 4242, start: "778", state: "S" }, record), false, "a reused PID");
  assert.equal(recordedOwnerAlive(null, record), false);
});
